[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/gandul5333/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/gandul5333/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

# Dip Rider — cbBTC/USDC bot for make.fun btc-race-24h-20261117-0603

Long-only bot trading Coinbase Wrapped BTC against USDC, one 1-minute bar
at a time, in the `agent-fun/bars-replay/v1` replay. Entry `main.ts` (Node 22,
stdlib only); the wire shim in `vendor/` is the kit's SDK copied byte for byte.

**Strategy:** buy the dip — full size when the close falls 90 bps under its
360-bar average, sell on recovery to 30 bps over it (100 bps stop). If no
trade has filled by bar 720, a late trend rider buys a confirmed uptrend
(240-bar return +80 bps) with an 80 bps trailing stop. 30-bar cooldown after
every exit. All integer math, no clock, fully deterministic.

**Dev window (local grade, real harness): net PnL +13.57 USDC**, 4 trades,
win rate 100%, max drawdown 0.72%, 0 rejected. Best kit baseline on the same
window: momentum +2.45 USDC.
