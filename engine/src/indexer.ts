import { EventEmitter } from "node:events";
import { parseEventLogs, type Log } from "viem";
import { ClutchHookAbi, toUsdc, type TradeEvent } from "@clutch/shared";
import { config } from "./config";
import { publicClient } from "./chain";
import { kvGet, kvSet, one, run } from "./db";
import { log } from "./log";

/**
 * Chain indexer. Pages through ClutchHook logs from a persisted cursor (backfill on boot, then tail), writing
 * trades and claims to the database. Idempotent on (tx, logIndex), so restarts and overlaps are safe.
 */
export class Indexer extends EventEmitter {
  private running = false;
  private readonly step = BigInt(process.env.INDEX_STEP ?? (config.local ? "5000" : "2000"));

  async start() {
    this.running = true;
    while (this.running) {
      try {
        const caughtUp = await this.tick();
        if (caughtUp) await new Promise((r) => setTimeout(r, config.local ? 700 : 2000));
      } catch (e: any) {
        log.warn("indexer", e.shortMessage ?? e.message);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  stop() {
    this.running = false;
  }

  private async tick(): Promise<boolean> {
    const head = await publicClient.getBlockNumber();
    const from = BigInt((await kvGet("indexer:next")) ?? String(config.deployment.deployBlock));
    if (from > head) return true;
    const to = from + this.step - 1n < head ? from + this.step - 1n : head;
    const logs = await publicClient.getLogs({ address: config.deployment.clutchHook, fromBlock: from, toBlock: to });
    if (logs.length) await this.ingest(logs, to === head);
    await kvSet("indexer:next", String(to + 1n));
    return to === head;
  }

  private async ingest(logs: Log[], live: boolean) {
    const events = parseEventLogs({ abi: ClutchHookAbi, logs });
    const blockTimes = new Map<bigint, number>();
    const timeOf = async (bn: bigint) => {
      if (live) return Date.now();
      if (!blockTimes.has(bn)) blockTimes.set(bn, Number((await publicClient.getBlock({ blockNumber: bn })).timestamp) * 1000);
      return blockTimes.get(bn)!;
    };
    for (const ev of events) {
      const at = await timeOf(ev.blockNumber!);
      if (ev.eventName === "Backed") {
        const a = ev.args;
        const r = await run(
          `INSERT OR IGNORE INTO trades (tx, log_index, market_id, trader, nullifier, yes, amount, shares, price_after, block, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [ev.transactionHash!, ev.logIndex!, Number(a.id), a.trader.toLowerCase(), String(a.nullifier), a.yes ? 1 : 0, toUsdc(a.amountIn), toUsdc(a.shares), Number(a.priceYesAfter) / 1e18, Number(ev.blockNumber), at],
        );
        if (r.rowsAffected) {
          await run(`UPDATE markets SET price_yes = ? WHERE id = ?`, [Number(a.priceYesAfter) / 1e18, Number(a.id)]);
          const m = await one<{ slug: string }>(`SELECT slug FROM markets WHERE id = ?`, [Number(a.id)]);
          const t: TradeEvent = {
            marketId: Number(a.id),
            slug: m?.slug ?? "",
            trader: a.trader,
            yes: a.yes,
            amount: toUsdc(a.amountIn),
            shares: toUsdc(a.shares),
            priceYesAfter: Number(a.priceYesAfter) / 1e18,
            at,
            tx: ev.transactionHash!,
          };
          this.emit("trade", t);
        }
      } else if (ev.eventName === "Claimed") {
        await run(`INSERT OR IGNORE INTO claims (tx, log_index, market_id, trader, amount, at) VALUES (?,?,?,?,?,?)`, [
          ev.transactionHash!,
          ev.logIndex!,
          Number(ev.args.id),
          ev.args.trader.toLowerCase(),
          toUsdc(ev.args.amount),
          at,
        ]);
        this.emit("claim", { marketId: Number(ev.args.id), trader: ev.args.trader });
      } else if (ev.eventName === "MarketResolved") {
        const outcome = (["NONE", "YES", "NO", "VOID"] as const)[Number(ev.args.outcome)];
        // The engine writes richer state when it resolves; this only fills gaps (e.g. markets expired by anyone).
        await run(`UPDATE markets SET outcome = COALESCE(outcome, ?), phase = CASE WHEN phase IN ('settled','void') THEN phase ELSE ? END WHERE id = ?`, [
          outcome,
          outcome === "VOID" ? "void" : "settled",
          Number(ev.args.id),
        ]);
      }
    }
  }
}
