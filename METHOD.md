# METHOD — Pump.fun Replay Sprint bot

Competition: `u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122`
("Pump.fun Replay Sprint — Paper Bot, Real Ranking"). Repo: yansz54/pump-replay.

## Strategy in one paragraph

A selective launch sniper. It watches every new pump.fun bonding curve from
its `CreateEvent`, reads the opening tape — how much real SOL the curve holds,
how big the creator's own buy was, how many other wallets piled in, whether
the creator already sold — and buys ONLY launches that pass a tight filter, at
a fixed small size, then exits fast on a take-profit, a stop-loss, or a short
deadline. One buy per coin, never adds, never pyramids.

## Rules (all in `main.ts`, single file, Node 22 stdlib only)

Entry — a coin is bought once, and only if ALL of these hold at decision time:
- age ≤ 3 slots since its `CreateEvent`;
- real SOL reserves between 5 and 30 SOL;
- creator's own buys in the create slot ≤ 1.5 SOL;
- ≤ 3 distinct non-creator buyers seen so far;
- creator has not sold;
- a position slot is free (max 5 open) and free cash covers the buy + tx fee.

Size: a fixed 0.03 SOL per coin, capped at 1% of the curve's real SOL (the
harness cap), skipped if below 0.01 SOL. Every buy is therefore ≥ 0.01 SOL,
which is the competition's round-trip floor.

Exit — the whole position, on the first of:
- value ≥ cost × 1.15 (take profit, +15%);
- value ≤ cost × 0.80 (stop loss, −20%);
- held ≥ 30 slots (timeout).

Value is the net sell proceeds at the latest mark (or curve reserves) minus
the 1.25% curve fee (95 bps protocol + 30 bps creator) and one tx fee; cost is
the SOL spent plus tx fees paid. The harness force-closes on completion and
flattens at the end of the window; those fills end the position too.

What it does NOT do: no adds / pyramiding, no trailing stop, no partial
take-profit, no re-entry after an exit, no short, no leverage, no order
splitting. No clock, no randomness, no I/O, no network, no external package.
A pure function of the batches: two runs on the same window produce
byte-identical action logs (verified by `grade-local`, `l1.reproduced: true`).

## Dev-window results (kit's frozen window, `grade-local --driver process`)

| metric | value |
| --- | --- |
| net PnL | **−0.0055 SOL** (−5,469,234 lamports) |
| distinct mints | **48** (bar: 20) |
| round trips | 48 |
| fills | 96 |
| max drawdown | **0.0091** (bar: 0.50) |
| rejected / failed orders | 0 / 1 |
| two-run action logs | byte-identical (`l1.reproduced: true`) |
| result sha256 | `c6a386a026037acbaa515ca9d2065e5bd5157142b6d64df4fd1d3356b0a150ca` |

## Stress test (`grade-local --stress 20` — 20 rebuilt copies of the dev window)

| metric | value |
| --- | --- |
| median net PnL | **−0.082 SOL** |
| p10 / p90 | −0.151 / +0.0007 SOL |
| copies below zero | **17 of 20** (positive: 3, best +0.068 SOL) |
| failed copies | 0 |
| dev score rank among copies | **17 of 20** (dev was a good draw) |
| grader warning | "half or more of the rebuilt copies lost money" |

Honest read: the dev score (−0.0055) flattered the bot — it sits at the 85th
percentile of the rebuilt copies. On resampled windows the bot is a small,
consistent loser (median −0.08, positive ~15% of the time). The copies are a
spread, not a forecast of the fresh final window, but they show the dev
number depends heavily on this window's own coins. The bot is still the best
point found in the flat near-breakeven region (neighbouring parameter cells
all land −0.02…−0.15 on dev), and no re-tuning was done against the stress
copies — that would be overfitting to resamples.

(The offline sim port of the same strategy reported −0.021 SOL; the real
engine's seed/failure draws differ slightly. The `grade-local` number above is
the authoritative one.)

## Why this shape — what the research showed

Backtests on the full dev window (all 3 dataset parts, 1,222 creates, 128,058
events), using the kit's own sim:

- The market charges 1.25% curve fee per leg + 105,000 lamports tx fee per
  order, and the 2-slot latency buys into pumps and sells into dumps. Every
  simple family tested ends slightly negative after fees:
  - momentum (pyramid to 2 SOL/position): −9.38 SOL on part 0 alone;
  - reversion (buy the dip): −1.78 SOL on part 0;
  - launch sniper, broad (0.3 SOL min real): −0.41 SOL full window;
  - pyramid-into-strength (adds on +15%): −2.53 SOL — adds buy the top;
  - migration riding (enter at 30–50 SOL real): ≈ −0.09× per trade.
- The edge is in SELECTION, not holding: the fewer, more-established coins
  the bot trades, the closer to breakeven (0.3 SOL min-real: −0.41; 3 SOL:
  −0.16; 5 SOL: −0.06). Smaller stakes and a tighter creator-buy cap help
  the same way. The chosen point (5 SOL min real, 0.03 SOL stake, 1.5 SOL
  max dev buy) sits in a flat, near-breakeven region — not a tuned spike:
  neighbouring cells (min real 4–7 SOL, stake 0.03–0.05, dev buy 1.0–2.5)
  all land between −0.02 and −0.15 SOL.
- A prize needs net PnL > 0 SOL, and the final window is a FRESH 24h. So the
  goal is the highest chance of a positive PnL on an unseen window, not the
  biggest dev-window number: a small, selective, low-variance bot with a
  near-zero mean is more likely to be positive on a new window than a bot
  that trades 350 coins at −0.4 SOL. Nothing here keys on a specific mint or
  timestamp — only launch-tape rules that generalise.

## Files

- `main.ts` — the whole bot (strategy + entrypoint). Imports only the
  vendored SDK shim.
- `vendor/makefun-bot.ts` — byte-identical copy of the kit's `sdk/ts/
  makefun-bot.ts` (the protocol shim; kept out of authorship counts).
- `METHOD.md` — this file. `README.md` — badges. `LICENSE` — MIT.
