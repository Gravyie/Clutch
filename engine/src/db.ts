import { createClient, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

/**
 * Persistence. libsql: a local SQLite file in development, Turso (DATABASE_URL + DATABASE_AUTH_TOKEN) in production.
 * The chain is the source of truth for money; this database holds the index of it plus everything off-chain:
 * streams, rules, timelines, receipts, refusals, humans, profiles.
 */
mkdirSync(config.dataDir, { recursive: true });
export const db = createClient({
  url: process.env.DATABASE_URL ?? `file:${join(config.dataDir, `clutch-${config.chainId}.db`)}`,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS streams (
    slug TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    lichess_channel TEXT,
    lichess_user TEXT,
    twitch_channel TEXT,
    owner_address TEXT,
    owner_nullifier TEXT,
    pool_id TEXT,
    token TEXT,
    currency0 TEXT,
    currency1 TEXT,
    latency_buffer INTEGER NOT NULL DEFAULT 8,
    vetoed TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS markets (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL,
    question TEXT NOT NULL,
    template TEXT NOT NULL,
    rule TEXT NOT NULL,
    rule_hash TEXT NOT NULL,
    ai TEXT NOT NULL,
    p_yes0 REAL NOT NULL,
    price_yes REAL NOT NULL,
    b REAL NOT NULL,
    subsidy REAL NOT NULL,
    opened_at INTEGER NOT NULL,
    lock_time INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    phase TEXT NOT NULL,
    outcome TEXT,
    void_reason TEXT,
    tx_open TEXT,
    tx_resolve TEXT,
    game_id TEXT,
    timeline TEXT,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS markets_slug ON markets(slug, opened_at DESC)`,
  `CREATE INDEX IF NOT EXISTS markets_phase ON markets(phase)`,
  `CREATE TABLE IF NOT EXISTS trades (
    tx TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    market_id INTEGER NOT NULL,
    trader TEXT NOT NULL,
    nullifier TEXT,
    yes INTEGER NOT NULL,
    amount REAL NOT NULL,
    shares REAL NOT NULL,
    price_after REAL NOT NULL,
    block INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tx, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS trades_market ON trades(market_id, at)`,
  `CREATE INDEX IF NOT EXISTS trades_trader ON trades(trader)`,
  `CREATE TABLE IF NOT EXISTS claims (
    tx TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    market_id INTEGER NOT NULL,
    trader TEXT NOT NULL,
    amount REAL NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tx, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS claims_trader ON claims(trader)`,
  `CREATE TABLE IF NOT EXISTS receipts (market_id INTEGER PRIMARY KEY, slug TEXT NOT NULL, json TEXT NOT NULL, resolved_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS refusals (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS humans (
    nullifier TEXT PRIMARY KEY,
    credential TEXT NOT NULL,
    age_verified INTEGER NOT NULL,
    verified_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS human_wallets (address TEXT PRIMARY KEY, nullifier TEXT NOT NULL, linked_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS profiles (address TEXT PRIMARY KEY, name TEXT, lichess TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  // World IdP account (pairwise sub) linked to the person's IDKit nullifier, the first time they authorize an agent
  `CREATE TABLE IF NOT EXISTS idp_links (iss TEXT NOT NULL, sub TEXT NOT NULL, nullifier TEXT NOT NULL UNIQUE, linked_at INTEGER NOT NULL, PRIMARY KEY (iss, sub))`,
  `CREATE TABLE IF NOT EXISTS agents (
    address TEXT PRIMARY KEY,
    nullifier TEXT NOT NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    cap_usdc REAL NOT NULL,
    pass TEXT,
    expires_at INTEGER NOT NULL,
    authorized_at INTEGER NOT NULL,
    auth_time INTEGER NOT NULL,
    acr TEXT,
    revoked_at INTEGER
  )`,
];

const COLUMNS = [`ALTER TABLE streams ADD COLUMN platform TEXT`, `ALTER TABLE streams ADD COLUMN channel TEXT`, `ALTER TABLE streams ADD COLUMN category TEXT`];

export async function migrate() {
  for (const s of SCHEMA) await db.execute(s);
  for (const c of COLUMNS) await db.execute(c).catch(() => {}); // already present
}

export async function all<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  const r = await db.execute({ sql, args });
  return r.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

export async function run(sql: string, args: InValue[] = []) {
  return db.execute({ sql, args });
}

export async function kvGet(k: string): Promise<string | undefined> {
  return (await one<{ v: string }>("SELECT v FROM kv WHERE k = ?", [k]))?.v;
}

export async function kvSet(k: string, v: string) {
  await run("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [k, v]);
}
