# Pump.fun Replay Sprint — Paper Bot, Real Ranking

A selective launch-sniper bot for the make.fun Pump.fun Replay Sprint: it
buys only the most established new pump.fun launches (5+ SOL of real reserves
in their first 3 slots, small creator buy, few early buyers, creator hasn't
sold), at a fixed 0.03 SOL, and exits fast at +15% / −20% / 30 slots. One buy
per coin, never adds. Fully deterministic — two runs produce byte-identical
action logs.

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![make.fun · rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/yansz54/pump-replay/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![make.fun · reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/yansz54/pump-replay/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

## Dev-window result (`grade-local --driver process`)

- Net PnL: **−0.0055 SOL**
- Distinct mints: **48** (bar: 20) · round trips: 48 · fills: 96
- Max drawdown: **0.0091** (bar: 0.50)
- Two-run action logs: byte-identical

## How it works

See [METHOD.md](METHOD.md) for the full strategy, rules, and research notes.

## Run

The grader runs it as `node /bot/main.ts` (Node strips types, no build).
`main.ts` is the whole bot; `vendor/makefun-bot.ts` is the kit's protocol
shim, vendored byte-identical.

## License

MIT — see [LICENSE](LICENSE).
