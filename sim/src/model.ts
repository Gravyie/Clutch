/**
 * Blackout Guard economic model.
 *
 * A full-range constant-product pool (equivalent to full-range v3/v4 liquidity) is left at a stale price P0 while
 * the external price moves to P1 during a sequencer outage. When blocks resume, arbitrageurs trade the pool back
 * toward P1. We compare fee schedules on what LPs collect versus what arbitrage keeps.
 *
 * Fee is charged on input (as in Uniswap). An arbitrage at fee f stops where the pool's marginal price, net of fee,
 * equals the external price, i.e. it leaves a no-arbitrage band of width f around P1.
 */

export interface Pool {
  x: number; // ETH
  y: number; // USDC
}

export interface Schedule {
  name: string;
  /** fee (fraction) at block k after recovery; k = 0 is the first block */
  fee(k: number): number;
}

export interface Arb {
  profit: number; // USDC, valued at P1
  lpFees: number; // USDC
  pool: Pool;
}

/** Optimal single arbitrage against a stale pool at fee f, external price P (USDC per ETH). */
export function arbitrage(p: Pool, P: number, f: number, gasUsd = 0): Arb | null {
  const k = p.x * p.y;
  const g = 1 - f;
  const price = p.y / p.x;
  if (price < P * g) {
    // Pool ETH too cheap: buy ETH with USDC until y'/x' = P·(1−f).  Effective input dy·g moves the curve.
    const y1 = Math.sqrt(k * P * g);
    const dyEff = y1 - p.y;
    const dy = dyEff / g;
    const x1 = k / y1;
    const dx = p.x - x1;
    const profit = dx * P - dy - gasUsd;
    if (profit <= 0) return null;
    return { profit, lpFees: dy - dyEff, pool: { x: x1, y: p.y + dy } };
  }
  if (price > P / g) {
    // Pool ETH too expensive: sell ETH until y'/x' = P/(1−f).
    const x1 = Math.sqrt((k * g) / P);
    const dxEff = x1 - p.x;
    const dx = dxEff / g;
    const y1 = k / x1;
    const dy = p.y - y1;
    const profit = dy - dx * P - gasUsd;
    if (profit <= 0) return null;
    return { profit, lpFees: (dx - dxEff) * P, pool: { x: p.x + dx, y: y1 } };
  }
  return null;
}

export interface Outcome {
  schedule: string;
  arbProfit: number;
  lpFees: number;
  residualMispricing: number; // |pool price / P1 − 1| after the run
  firstTradeBlock: number | null;
  noiseFeesLost: number;
}

export interface Scenario {
  tvlUsd: number;
  p0: number;
  jump: number; // e.g. 0.05 for +5%
  blocks: number;
  gasUsd: number;
  /** ordinary (non-arb) volume per block, USDC, at base fee */
  noiseVolumePerBlock: number;
  baseFee: number;
  /** noise traders' tolerance: participation = exp(−(f − base)/tau) */
  noiseTau: number;
}

export const DEFAULT: Scenario = {
  tvlUsd: 4_000_000,
  p0: 2000,
  jump: 0.05,
  blocks: 1000,
  gasUsd: 0.05,
  noiseVolumePerBlock: 400,
  baseFee: 0.003,
  noiseTau: 0.01,
};

function initialPool(s: Scenario): Pool {
  return { x: s.tvlUsd / 2 / s.p0, y: s.tvlUsd / 2 };
}

const noiseLost = (s: Scenario, f: number) => s.noiseVolumePerBlock * s.baseFee * (1 - Math.exp(-(Math.max(0, f - s.baseFee)) / s.noiseTau)) - 0;

/**
 * Competitive arbitrage: every block, if a profitable trade exists at the current fee, someone takes it.
 * This is the Dutch-auction case: the first trade happens at the highest fee the jump can bear.
 */
export function runCompetitive(sched: Schedule, s: Scenario): Outcome {
  let pool = initialPool(s);
  const P1 = s.p0 * (1 + s.jump);
  let arbProfit = 0;
  let lpFees = 0;
  let first: number | null = null;
  let lost = 0;
  for (let b = 0; b < s.blocks; b++) {
    const f = sched.fee(b);
    lost += noiseLost(s, f);
    const a = arbitrage(pool, P1, f, s.gasUsd);
    if (!a) continue;
    first ??= b;
    arbProfit += a.profit;
    lpFees += a.lpFees;
    pool = a.pool;
  }
  return { schedule: sched.name, arbProfit, lpFees, residualMispricing: Math.abs(pool.y / pool.x / P1 - 1), firstTradeBlock: first, noiseFeesLost: lost };
}

/**
 * Withholding (monopolist) arbitrage: a single arbitrageur with no competition picks the one block that maximises
 * their profit, then keeps cleaning up any later band. The auction's failure case.
 */
export function runWithholding(sched: Schedule, s: Scenario): Outcome {
  const pool0 = initialPool(s);
  const P1 = s.p0 * (1 + s.jump);
  let best = { b: -1, profit: -Infinity };
  for (let b = 0; b < s.blocks; b++) {
    const a = arbitrage(pool0, P1, sched.fee(b), s.gasUsd);
    if (a && a.profit > best.profit) best = { b, profit: a.profit };
  }
  if (best.b < 0) return { ...runCompetitive({ name: sched.name, fee: () => 1 }, s), schedule: sched.name, firstTradeBlock: null };
  // Before the chosen block nobody trades; from then on behave competitively.
  return runCompetitive({ name: sched.name, fee: (k) => (k < best.b ? 0.99 : sched.fee(k)) }, s);
}

/**
 * Stochastic entry: a monopolist waits, but each block a competitor appears with probability q and takes the trade.
 * The monopolist trades at the first block where taking it now beats the expected value of waiting.
 */
export function runStochastic(sched: Schedule, s: Scenario, q: number): Outcome {
  const pool0 = initialPool(s);
  const P1 = s.p0 * (1 + s.jump);
  const profitAt = (b: number) => arbitrage(pool0, P1, sched.fee(b), s.gasUsd)?.profit ?? 0;
  // Backward induction on V(b) = max(profit(b), (1−q)·V(b+1)).
  const V = new Array(s.blocks + 1).fill(0);
  for (let b = s.blocks - 1; b >= 0; b--) V[b] = Math.max(profitAt(b), (1 - q) * V[b + 1]);
  let stop = s.blocks;
  for (let b = 0; b < s.blocks; b++) {
    if (profitAt(b) > 0 && profitAt(b) >= (1 - q) * V[b + 1]) {
      stop = b;
      break;
    }
  }
  return runCompetitive({ name: sched.name, fee: (k) => (k < stop ? 0.99 : sched.fee(k)) }, s);
}

// ── Fee schedules ───────────────────────────────────────────────────────────────────────────

export const schedules = (blocksFor30Min = 900): Schedule[] => [
  { name: "zero fee", fee: () => 0 },
  { name: "static 0.3%", fee: () => 0.003 },
  { name: "static 3%", fee: () => 0.03 },
  { name: "original: 3%→0.3% over 30 min", fee: (k) => (k >= blocksFor30Min ? 0.003 : 0.03 - (0.027 * k) / blocksFor30Min) },
  { name: "Blackout Guard: 15%→0.3% over 40 blocks", fee: (k) => (k >= 40 ? 0.003 : 0.15 - (0.147 * k) / 40) },
  { name: "Blackout Guard: 6%→0.3% over 30 blocks", fee: (k) => (k >= 30 ? 0.003 : 0.06 - (0.057 * k) / 30) },
];
