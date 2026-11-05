import type { LeaderRow, MarketView, Outcome, Portfolio, Position, PricePoint, Receipt, Refusal, TradeEvent } from "@clutch/shared";
import { all, one } from "./db";

interface MarketRow {
  id: number;
  slug: string;
  question: string;
  template: string;
  rule: string;
  rule_hash: string;
  ai: string;
  p_yes0: number;
  price_yes: number;
  b: number;
  subsidy: number;
  opened_at: number;
  lock_time: number;
  window_start: number;
  window_end: number;
  phase: MarketView["phase"];
  outcome: Outcome | null;
  void_reason: string | null;
  tx_open: string | null;
  tx_resolve: string | null;
  title?: string;
  volume?: number;
  trades?: number;
  traders?: number;
}

const MARKET_SELECT = `
  SELECT m.*, s.title,
    (SELECT COALESCE(SUM(amount),0) FROM trades t WHERE t.market_id = m.id) volume,
    (SELECT COUNT(*) FROM trades t WHERE t.market_id = m.id) trades,
    (SELECT COUNT(DISTINCT trader) FROM trades t WHERE t.market_id = m.id) traders
  FROM markets m LEFT JOIN streams s ON s.slug = m.slug`;

export function toView(r: MarketRow): MarketView {
  return {
    id: Number(r.id),
    slug: r.slug,
    streamTitle: r.title ?? r.slug,
    question: r.question,
    template: r.template,
    rule: JSON.parse(r.rule),
    ruleHash: r.rule_hash as `0x${string}`,
    phase: r.phase,
    openedAt: Number(r.opened_at),
    lockTime: Number(r.lock_time),
    windowStart: Number(r.window_start),
    windowEnd: Number(r.window_end),
    pYes0: Number(r.p_yes0),
    priceYes: Number(r.price_yes),
    b: Number(r.b),
    subsidy: Number(r.subsidy),
    volume: Number(r.volume ?? 0),
    trades: Number(r.trades ?? 0),
    traders: Number(r.traders ?? 0),
    outcome: r.outcome ?? undefined,
    voidReason: r.void_reason ?? undefined,
    ai: JSON.parse(r.ai),
    tx: { open: (r.tx_open ?? undefined) as `0x${string}` | undefined, resolve: (r.tx_resolve ?? undefined) as `0x${string}` | undefined },
  };
}

export async function listMarkets(opts: { slug?: string; open?: boolean; limit?: number }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.slug) (where.push("m.slug = ?"), args.push(opts.slug));
  if (opts.open !== undefined) where.push(opts.open ? "m.phase IN ('trading','locked','window','resolving')" : "m.phase IN ('settled','void')");
  const rows = await all<MarketRow>(`${MARKET_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.opened_at DESC LIMIT ?`, [...args, opts.limit ?? 50]);
  return rows.map(toView);
}

export async function marketDetail(id: number) {
  const row = await one<MarketRow>(`${MARKET_SELECT} WHERE m.id = ?`, [id]);
  if (!row) return null;
  const view = toView(row);
  const trades = await all<{ trader: string; yes: number; amount: number; shares: number; price_after: number; at: number; tx: string }>(
    `SELECT trader, yes, amount, shares, price_after, at, tx FROM trades WHERE market_id = ? ORDER BY at ASC`,
    [id],
  );
  const history: PricePoint[] = [{ t: view.openedAt * 1000, p: view.pYes0 }, ...trades.map((t) => ({ t: Number(t.at), p: Number(t.price_after) }))];
  const receipt = await one<{ json: string }>(`SELECT json FROM receipts WHERE market_id = ?`, [id]);
  const tape: TradeEvent[] = trades
    .slice(-40)
    .reverse()
    .map((t) => ({ marketId: id, slug: view.slug, trader: t.trader as `0x${string}`, yes: Boolean(t.yes), amount: Number(t.amount), shares: Number(t.shares), priceYesAfter: Number(t.price_after), at: Number(t.at), tx: t.tx as `0x${string}` }));
  return { market: view, history, trades: tape, receipt: receipt ? (JSON.parse(receipt.json) as Receipt) : null };
}

export async function recentReceipts(limit = 20, slug?: string) {
  const rows = await all<{ json: string }>(`SELECT json FROM receipts ${slug ? "WHERE slug = ?" : ""} ORDER BY resolved_at DESC LIMIT ?`, slug ? [slug, limit] : [limit]);
  return rows.map((r) => JSON.parse(r.json) as Receipt);
}

export async function receipt(id: number) {
  const r = await one<{ json: string }>(`SELECT json FROM receipts WHERE market_id = ?`, [id]);
  return r ? (JSON.parse(r.json) as Receipt) : null;
}

export async function recentRefusals(limit = 20, slug?: string) {
  const rows = await all<{ json: string }>(`SELECT json FROM refusals ${slug ? "WHERE slug = ?" : ""} ORDER BY at DESC LIMIT ?`, slug ? [slug, limit] : [limit]);
  return rows.map((r) => JSON.parse(r.json) as Refusal);
}

export async function recentTrades(limit = 30) {
  const rows = await all<{ market_id: number; slug: string; trader: string; yes: number; amount: number; shares: number; price_after: number; at: number; tx: string }>(
    `SELECT t.*, m.slug FROM trades t LEFT JOIN markets m ON m.id = t.market_id ORDER BY t.at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(
    (t): TradeEvent => ({ marketId: Number(t.market_id), slug: t.slug ?? "", trader: t.trader as `0x${string}`, yes: Boolean(t.yes), amount: Number(t.amount), shares: Number(t.shares), priceYesAfter: Number(t.price_after), at: Number(t.at), tx: t.tx as `0x${string}` }),
  );
}

interface PosRow {
  market_id: number;
  slug: string;
  question: string;
  phase: MarketView["phase"];
  outcome: Outcome | null;
  price_yes: number;
  opened_at: number;
  yes: number;
  no: number;
  cost: number;
  claimed: number;
  trader?: string;
}

const POSITION_SELECT = `
  SELECT t.market_id, t.trader, m.slug, m.question, m.phase, m.outcome, m.price_yes, m.opened_at,
    SUM(CASE WHEN t.yes = 1 THEN t.shares ELSE 0 END) yes,
    SUM(CASE WHEN t.yes = 0 THEN t.shares ELSE 0 END) no,
    SUM(t.amount) cost,
    EXISTS(SELECT 1 FROM claims c WHERE c.market_id = t.market_id AND c.trader = t.trader) claimed
  FROM trades t JOIN markets m ON m.id = t.market_id`;

function toPosition(r: PosRow): Position {
  const settled = r.phase === "settled" || r.phase === "void";
  const yes = Number(r.yes);
  const no = Number(r.no);
  const cost = Number(r.cost);
  const p = Number(r.price_yes);
  const payout = r.outcome === "VOID" ? cost : r.outcome === "YES" ? yes : r.outcome === "NO" ? no : 0;
  const value = settled ? payout : yes * p + no * (1 - p);
  return {
    marketId: Number(r.market_id),
    slug: r.slug,
    question: r.question,
    phase: r.phase,
    outcome: r.outcome ?? undefined,
    priceYes: p,
    yes,
    no,
    cost,
    value,
    claimed: Boolean(r.claimed),
    claimable: settled && !r.claimed ? payout : 0,
    openedAt: Number(r.opened_at),
  };
}

export async function portfolio(address: string): Promise<Portfolio> {
  const rows = await all<PosRow>(`${POSITION_SELECT} WHERE t.trader = ? GROUP BY t.market_id ORDER BY m.opened_at DESC`, [address.toLowerCase()]);
  const positions = rows.map(toPosition);
  const settled = positions.filter((p) => p.phase === "settled" || p.phase === "void");
  return {
    address: address as `0x${string}`,
    positions,
    stats: {
      volume: positions.reduce((a, p) => a + p.cost, 0),
      realizedPnl: settled.reduce((a, p) => a + p.value - p.cost, 0),
      openValue: positions.filter((p) => !settled.includes(p)).reduce((a, p) => a + p.value, 0),
      claimable: positions.reduce((a, p) => a + p.claimable, 0),
      markets: positions.length,
      won: settled.filter((p) => p.outcome !== "VOID" && p.value > p.cost).length,
      lost: settled.filter((p) => p.outcome !== "VOID" && p.value < p.cost).length,
    },
  };
}

export async function leaderboard(limit = 50): Promise<LeaderRow[]> {
  const rows = await all<PosRow>(`${POSITION_SELECT} WHERE m.phase IN ('settled','void') GROUP BY t.market_id, t.trader`);
  const names = new Map((await all<{ address: string; name: string | null }>(`SELECT address, name FROM profiles`)).map((r) => [r.address, r.name ?? undefined]));
  const by = new Map<string, { pnl: number; volume: number; markets: number; wins: number; decided: number }>();
  for (const r of rows) {
    const p = toPosition(r);
    const k = r.trader!;
    const e = by.get(k) ?? { pnl: 0, volume: 0, markets: 0, wins: 0, decided: 0 };
    e.pnl += p.value - p.cost;
    e.volume += p.cost;
    e.markets += 1;
    if (p.outcome !== "VOID") {
      e.decided += 1;
      if (p.value > p.cost) e.wins += 1;
    }
    by.set(k, e);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].pnl - a[1].pnl)
    .slice(0, limit)
    .map(([address, e], i) => ({ rank: i + 1, address: address as `0x${string}`, name: names.get(address), pnl: e.pnl, volume: e.volume, markets: e.markets, winRate: e.decided ? e.wins / e.decided : 0 }));
}

export async function todayByStream() {
  const since = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
  const rows = await all<{ slug: string; settled: number; volume: number }>(
    `SELECT m.slug, SUM(CASE WHEN m.phase IN ('settled','void') THEN 1 ELSE 0 END) settled,
       (SELECT COALESCE(SUM(t.amount),0) FROM trades t JOIN markets m2 ON m2.id = t.market_id WHERE m2.slug = m.slug AND m2.opened_at >= ?) volume
     FROM markets m WHERE m.opened_at >= ? GROUP BY m.slug`,
    [since, since],
  );
  return new Map(rows.map((r) => [r.slug, { settled: Number(r.settled), volume: Number(r.volume) }]));
}

export async function platformStats() {
  const r = await one<{ markets: number; volume: number; traders: number; voids: number }>(
    `SELECT (SELECT COUNT(*) FROM markets WHERE phase IN ('settled','void')) markets,
            (SELECT COALESCE(SUM(amount),0) FROM trades) volume,
            (SELECT COUNT(DISTINCT trader) FROM trades) traders,
            (SELECT COUNT(*) FROM markets WHERE outcome = 'VOID') voids`,
  );
  return { markets: Number(r?.markets ?? 0), volume: Number(r?.volume ?? 0), traders: Number(r?.traders ?? 0), voids: Number(r?.voids ?? 0) };
}
