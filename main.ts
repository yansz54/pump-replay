// Pump.fun Replay Sprint — "Established-launch sniper".
//
// A single-file, deterministic, stdlib-only bot for agent-fun/replay/v2.
// It watches every new pump.fun bonding curve from its CreateEvent, reads the
// opening tape (creator's own buy, how many other wallets piled in, whether the
// creator already sold, how much real SOL the curve holds), and buys ONLY the
// launches that pass a tight filter — then takes profit fast, cuts losers fast,
// and never holds past a short deadline. One buy per coin, never adds, never
// pyramids: on this market the 2-slot latency turns every add into a chase.
//
// Why this shape (from backtests on the kit's frozen dev window, full 3 parts):
//   - Every simple family tested loses a little after the 1.25% curve fee per
//     leg + 105k lamports tx fee per order. The edge is in SELECTION, not in
//     holding: the fewer, more-established coins the bot trades, the closer to
//     breakeven it gets (0.3 SOL min-real: -0.41 SOL; 3 SOL: -0.16; 5 SOL: -0.06).
//   - Pyramiding into strength lost badly (-2.5 SOL): by the time a price is
//     up enough to justify an add, the top is near and the add buys the dump.
//   - Momentum (-9.4 SOL on part 0) and reversion (-1.8 SOL) both bleed: the
//     2-slot latency buys into pumps and sells into dumps.
//   - So the bot trades a small, selective set (5 SOL+ of real reserves in its
//     first 3 slots, creator buy <= 1.5 SOL, <= 3 distinct non-creator buyers,
//     creator has not sold) at a fixed 0.03 SOL, exits at +15% / -20% / 30 slots.
//   - The final window is a FRESH 24h, so nothing here keys on a specific mint
//     or timestamp: only launch-tape rules that generalise.
//
// Guardrails: every buy is 0.03 SOL (>= the 0.01 SOL round-trip floor), the bot
// trades 50 distinct mints on the dev window (bar is 20), max drawdown 0.011
// (bar is 0.50), net PnL -0.021 SOL on the dev window. A prize needs net PnL
// > 0 SOL; this bot aims to be the least-negative / most-likely-positive entry
// by keeping fee drag and variance small, not by chasing the biggest runner.
//
// Determinism: a pure function of the batches it is fed. No clock, no random,
// no I/O, no Date. Maps iterate in first-seen order. Two runs on the same
// window produce byte-identical action logs.
//
// Run by the grader as `node /bot/main.ts` (Node strips types, no build).
// The protocol lives in the vendored SDK shim (vendor/makefun-bot.ts, a
// byte-identical copy of the kit's sdk/ts/makefun-bot.ts).

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  BPS,
  runBot,
  type Batch,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

// ---------------------------------------------------------------- parameters

/** Lamports per SOL. */
const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Curve fee per leg: protocol 95 bps + creator 30 bps. */
const CURVE_FEE_BPS = 125n;

const PARAMS = {
  /** Fixed SOL to spend per coin (lamports). */
  stakeLamports: 30_000_000n,
  /** Smallest single buy worth paying the tx fee for — and the guardrail floor. */
  minBuyLamports: 10_000_000n,
  /** Oldest age (slots since create) at which a first buy may still be decided. */
  maxAge: 3,
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: 5_000_000_000n,
  maxRealSol: 30_000_000_000n,
  /** Creator's own buys in the create slot: at most this (lamports). */
  maxDevBuy: 1_500_000_000n,
  /** Distinct non-creator buyers seen before entry: at most this. */
  maxBuyers: 3,
  /** Creator sold before entry: skip the coin. */
  skipDevSold: true,
  /** Slippage allowed on buys and sells (bps). */
  slippageBps: 10_000,
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: 1_500n,
  /** Exit when it is worth this much under its cost (bps). */
  slBps: 2_000n,
  /** Exit after holding this many slots. */
  maxHold: 30,
} as const;

// ---------------------------------------------------------------- tape

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Creator's own buys in the create slot (lamports). */
  devBuy: bigint;
  /** Distinct non-creator buyers seen so far. */
  buyers: Set<Pubkey>;
  /** Creator sold at least once. */
  devSold: boolean;
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** Tx fees paid on this position's fills so far (lamports). */
  txPaid: bigint;
}

/** What selling `tokens` against (vq, vt) pays after the curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const quote = (tokens * vq) / (vt + tokens);
  return quote - (quote * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

// ---------------------------------------------------------------- strategy

export interface StrategyParams {
  stakeLamports: bigint;
  minBuyLamports: bigint;
  maxAge: number;
  minRealSol: bigint;
  maxRealSol: bigint;
  maxDevBuy: bigint;
  maxBuyers: number;
  skipDevSold: boolean;
  slippageBps: number;
  tpBps: bigint;
  slBps: bigint;
  maxHold: number;
}

export function createStrategy(overrides: Partial<StrategyParams> = {}) {
  const P: StrategyParams = { ...PARAMS, ...overrides };
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          devBuy: 0n,
          buyers: new Set(),
          devSold: false,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        let c = coins.get(e.mint);
        if (c === undefined) {
          // Defensive: a trade before its create (never happens in-universe).
          c = {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            devBuy: 0n,
            buyers: new Set(),
            devSold: false,
            done: false,
            complete: false,
          };
          coins.set(e.mint, c);
        }
        const sol = BigInt(e.sol_amount);
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  }

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === 'buy') return true;
    }
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === 'sell') return true;
    }
    return false;
  }

  function onBatch(state: BotState, batch: Batch): OrderInput[] {
    readEvents(batch);
    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
    for (const m of batch.marks) {
      marks.set(m.mint, {
        vq: BigInt(m.virtual_quote_reserves),
        vt: BigInt(m.virtual_token_reserves),
      });
    }

    // Fills: track tx fees per held position; harness closes end a position.
    for (const f of batch.fills) {
      if (f.client_id.startsWith('_')) {
        held.delete(f.mint);
        continue;
      }
      const h = held.get(f.mint);
      if (f.status !== 'rejected' && h !== undefined) {
        h.txPaid += BigInt(f.tx_fee_lamports);
      }
      if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
        held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports) });
      }
    }
    // Drop held entries whose position is gone and nothing is pending.
    for (const mint of [...held.keys()]) {
      if (
        !state.positions.has(mint) &&
        !hasPendingBuy(state, mint) &&
        !hasPendingSell(state, mint)
      ) {
        held.delete(mint);
      }
    }

    // Exits first: take profit, cut loss, or time out — whole position.
    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (hasPendingSell(state, mint)) continue;
      const c = coins.get(mint);
      let h = held.get(mint);
      if (h === undefined) {
        h = { openedSlot: state.slot, txPaid: tx };
        held.set(mint, h);
      }
      let mk = marks.get(mint);
      if (mk === undefined) {
        const cv = state.curves.get(mint);
        if (cv === undefined) continue;
        mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
      }
      const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
      const basis = pos.cost_lamports + h.txPaid;
      let exit = false;
      if (basis > 0n) {
        if (value * BPS >= basis * (BPS + P.tpBps)) exit = true;
        if (value * BPS <= basis * (BPS - P.slBps)) exit = true;
      }
      if (state.slot - h.openedSlot >= P.maxHold) exit = true;
      if (!exit) continue;
      orders.push({
        side: 'sell',
        mint,
        token_amount: pos.token_amount,
        max_slippage_bps: P.slippageBps,
      });
      if (c !== undefined) c.done = true;
    }

    // Entries: one fixed-size buy per qualifying launch, nothing more.
    let free = state.freeCashLamports() - tx * BigInt(orders.length);
    let open = state.committedPositionCount();
    for (const c of coins.values()) {
      if (orders.length >= cap) break;
      if (c.done || c.complete) continue;
      if (hasPendingBuy(state, c.mint)) continue;
      if (open >= state.hello.caps.max_open_positions) continue;
      const age = state.slot - c.createSlot;
      if (age > P.maxAge) {
        c.done = true;
        continue;
      }
      if (P.skipDevSold && c.devSold) {
        c.done = true;
        continue;
      }
      const curve = state.curves.get(c.mint);
      if (curve === undefined || curve.complete) continue;
      const rq = curve.real_quote_reserves;
      if (rq < P.minRealSol || rq > P.maxRealSol) continue;
      if (c.devBuy > P.maxDevBuy) {
        c.done = true;
        continue;
      }
      if (c.buyers.size > P.maxBuyers) {
        c.done = true;
        continue;
      }
      // Fixed stake, capped at 1% of real SOL; skip dust the guardrail ignores.
      const maxBuy = state.maxBuyLamports(c.mint);
      const amount = P.stakeLamports < maxBuy ? P.stakeLamports : maxBuy;
      if (amount < P.minBuyLamports) continue;
      if (free < amount + tx) continue;
      orders.push({
        side: 'buy',
        mint: c.mint,
        quote_lamports: amount,
        max_slippage_bps: P.slippageBps,
      });
      free -= amount + tx;
      open += 1;
      c.done = true;
    }
    return orders;
  }

  return { onBatch };
}

// ---------------------------------------------------------------- entrypoint

const strategy = createStrategy();

// Run the protocol loop only when this file is the program the grader (or a
// human) started — `node /bot/main.ts`. When another module imports this file
// (offline tests), the strategy factory above is all that runs.
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runBot({ onBatch: (state, batch) => strategy.onBatch(state, batch) });
}
