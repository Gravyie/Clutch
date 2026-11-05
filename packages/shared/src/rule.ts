import { keccak256, toBytes } from "viem";
import type { Rule } from "./types";

/** JSON with keys sorted at every level, so the same rule always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export const ruleHash = (rule: Rule) => keccak256(toBytes(canonicalJson(rule)));

export const USDC_DECIMALS = 6;
export const toUsdc = (raw: bigint | number) => Number(raw) / 10 ** USDC_DECIMALS;
export const fromUsdc = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

export const ERROR_COPY: Record<string, { title: string; body: string }> = {
  StreamerCannotTradeOwnMarket: { title: "Trade blocked", body: "You stream this channel, so you can't trade its markets." },
  SelfExcludedUntil: { title: "You're self-excluded", body: "This human ID is excluded from trading. A new wallet won't change that." },
  DailyCapExceeded: { title: "Daily limit reached", body: "You've hit today's stake limit for this human ID. It resets at 00:00 UTC." },
  PassExpired: { title: "Human pass expired", body: "Verify again to keep trading. It takes one scan." },
  PassNotForThisWallet: { title: "Pass is for another wallet", body: "A human pass only works with the wallet it was issued to." },
  InvalidPass: { title: "Human pass invalid", body: "Verify with World ID to get a fresh pass." },
  MarketLocked: { title: "Trading closed", body: "This market locked. The window starts after every viewer has seen the lock." },
  MarketNotOpen: { title: "Market closed", body: "This market is no longer open." },
  ChainNotNormal: { title: "Chain recovering", body: "The sequencer is down or catching up. Blackout Guard pauses trading until blocks are trustworthy." },
  StreamIsPaused: { title: "Paused by the streamer", body: "The streamer paused markets on this stream." },
  Slippage: { title: "Price moved", body: "Odds moved before your trade landed. Try again." },
};
