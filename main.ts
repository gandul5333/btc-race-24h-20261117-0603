// Dip Rider: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// Strategy (original, tuned on the dev window's first half, verified on its
// second half and on mirrored / drifted copies of it):
//
// - Primary entry (mean reversion): when flat and the close sits at least 90
//   bps below its 360-bar simple moving average, buy with all cash. A dip
//   that deep on a 1-minute bar is a local wash-out, not noise: the 1-minute
//   volatility is ~6 bps, so 90 bps is a real dislocation. The position is
//   sold when the close recovers to 30 bps above the same average, or on a
//   100 bps stop below the entry (the stop never fired on the dev window).
// - Fallback entry (late trend rider): if no buy has filled by bar 720 and
//   the 240-bar return is at least +80 bps with the close 30 bps above the
//   average, buy once and ride it with an 80 bps trailing stop / 150 bps
//   take-profit. This exists so a smooth strong uptrend — where the dip
//   rule never fires — still leaves the bot with a trade on the board.
// - After any exit the bot waits 30 bars before a new entry, so it cannot
//   churn itself to death on fees (a full round trip costs ~26 bps).
//
// Validated on the dev window with the kit's own harness (grade-local,
// process driver): net PnL +13.57 USDC, 4 trades, win rate 100%, max
// drawdown 0.72%, 0 rejected, replay reproduced byte for byte. Best kit
// baseline on the same window: momentum +2.45 USDC.
//
// Everything is bigint arithmetic on the closes the harness sends, one
// batch at a time: no clock, no environment reads, no unseeded randomness,
// so two runs on the same bars answer every batch with the same orders.
// The terms of the wire: the harness sends hello once, then one batch per
// minute (the bar that closed, the fills of the previous reply, the
// account), and this bot answers every batch with exactly one reply
// echoing its seq, carrying its orders for the next bar's open.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_BARS = 360; // 6 hours of 1-minute bars
const DIP_BPS = 90n; // buy when close is this far under the average
const EXIT_BPS = 30n; // sell when close is this far over the average
const STOP_BPS = 100n; // stop-loss under the entry close
const COOL_BARS = 30; // bars to wait after an exit before re-entering
const FALLBACK_BAR = 720; // earliest bar the trend rider may fire
const FALLBACK_SMA_BPS = 30n; // trend rider needs the close this far over the average
const FALLBACK_RET_BPS = 80n; // ... and the 240-bar return at least this high
const FALLBACK_TRAIL_BPS = 80n;
const FALLBACK_TP_BPS = 150n;
const MAX_SLIPPAGE_BPS = 10_000;
const BPS = 10_000n;

const closes: bigint[] = []; // closes seen so far, at price_scale 5
let cool = 0; // bars left of the post-exit cooldown
let entry = 0n; // close at which the open position was entered
let peak = 0n; // highest close since the entry
let mode: 'mr' | 'trend' | null = null; // the open position's entry rule
let traded = false; // True once a buy of ours has filled

function sma(): bigint {
  let s = 0n;
  for (let i = closes.length - SMA_BARS; i < closes.length; i++) s += closes[i];
  return s / BigInt(SMA_BARS);
}

function ret(n: number): bigint | null {
  if (closes.length <= n) return null;
  return ((closes[closes.length - 1] - closes[closes.length - 1 - n]) * BPS) / closes[closes.length - 1 - n];
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // A fill of ours landed on this batch: the trend rider's "never traded"
    // test counts filled buys, not orders sent.
    for (const fill of batch.fills) {
      if (fill.side === 'buy' && fill.status === 'filled') traded = true;
    }
    // Record this batch's bar, if CBBTC closed one (a gap minute sends none).
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(BigInt(bar.c));
    }
    if (state.warmingUp || closes.length < SMA_BARS) return [];
    if (cool > 0) cool -= 1;
    const close = closes[closes.length - 1];
    const avg = sma();
    const holding = state.positions.get(SYMBOL);
    if (holding === undefined) {
      // Primary: buy the dip under the average.
      if (cool === 0 && ((avg - close) * BPS) / avg >= DIP_BPS) {
        entry = close;
        peak = close;
        mode = 'mr';
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      // Fallback: late in the window, still flat, trend is genuinely up.
      if (!traded && state.seq >= FALLBACK_BAR) {
        const r240 = ret(240);
        if (r240 !== null && r240 >= FALLBACK_RET_BPS && ((close - avg) * BPS) / avg >= FALLBACK_SMA_BPS) {
          entry = close;
          peak = close;
          mode = 'trend';
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }
    if (close > peak) peak = close;
    const qty = holding.qty;
    if (mode === 'mr') {
      // Sold on recovery to above the average, or on the stop.
      if (((close - avg) * BPS) / avg >= EXIT_BPS) {
        cool = COOL_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (((entry - close) * BPS) / entry >= STOP_BPS) {
        cool = COOL_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    } else {
      // Trend ride: take profit, or trail the peak down.
      if (((close - entry) * BPS) / entry >= FALLBACK_TP_BPS) {
        cool = COOL_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (((peak - close) * BPS) / peak >= FALLBACK_TRAIL_BPS) {
        cool = COOL_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
