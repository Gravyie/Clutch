import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const env = (k: string, d?: string) => process.env[k] ?? d;

export interface Deployment {
  chainId: number;
  deployBlock: number;
  owner: `0x${string}`;
  poolManager: `0x${string}`;
  usdc: `0x${string}`;
  sequencerFeed: `0x${string}`;
  sequencerGuard: `0x${string}`;
  humanPassGate: `0x${string}`;
  lpVault: `0x${string}`;
  router: `0x${string}`;
  clutchHook: `0x${string}`;
  blackoutGuardHook: `0x${string}`;
  agent: `0x${string}`;
  passSigner: `0x${string}`;
  ethPool: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; poolId: `0x${string}` };
}

const chainId = Number(env("CHAIN_ID", "31337"));
const local = chainId === 31337;

/** Lichess TV channels Clutch runs as house streams. Streamers add their own channels from the studio. */
export const HOUSE_CHANNELS = [
  { slug: "blitz", channel: "blitz", title: "Lichess Blitz", subtitle: "Top blitz game, live" },
  { slug: "bullet", channel: "bullet", title: "Lichess Bullet", subtitle: "Top bullet game, live" },
  { slug: "rapid", channel: "rapid", title: "Lichess Rapid", subtitle: "Top rapid game, live" },
  { slug: "classical", channel: "classical", title: "Lichess Classical", subtitle: "Top classical game, live" },
];

export const config = {
  root,
  port: Number(env("PORT", env("ENGINE_PORT", "8787"))),
  publicUrl: env("ENGINE_PUBLIC_URL", "http://localhost:8787")!,
  appOrigin: env("APP_ORIGIN", "http://localhost:3000")!,
  dataDir: env("DATA_DIR", join(root, "engine/data"))!,
  authSecret: env("AUTH_SECRET", "dev-only-secret-change-me")!,

  chainId,
  local,
  rpcUrl: env("RPC_URL", "http://127.0.0.1:8545")!,
  explorer: env("EXPLORER_URL", chainId === 84532 ? "https://sepolia.basescan.org" : chainId === 1301 ? "https://sepolia.uniscan.xyz" : "")!,
  deployment: JSON.parse(readFileSync(join(root, `contracts/deployments/${chainId}.json`), "utf8")) as Deployment,

  // Keys. Local defaults are anvil's well-known accounts: #0 owner (creates stream pools, faucet), #1 agent, #2 pass signer.
  ownerKey: env("OWNER_PRIVATE_KEY", local ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : undefined) as `0x${string}`,
  agentKey: env("AGENT_PRIVATE_KEY", local ? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" : undefined) as `0x${string}`,
  passSignerKey: env("PASS_SIGNER_PRIVATE_KEY", local ? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" : undefined) as `0x${string}`,

  // Streams
  houseChannels: env("HOUSE_CHANNELS", "blitz,bullet,rapid,classical")!.split(",").filter(Boolean),
  replay: env("REPLAY", local ? "1" : "0") === "1",
  defaultLatencyBufferSec: Number(env("LATENCY_BUFFER_SEC", "8")),
  twitchLatencyBufferSec: Number(env("TWITCH_LATENCY_BUFFER_SEC", "16")),
  tradingSec: Number(env("TRADING_SEC", "20")),
  cooldownSec: Number(env("COOLDOWN_SEC", "8")),
  liquidityB: Number(env("MARKET_B_USDC", "80")),
  faucetUsdc: Number(env("FAUCET_USDC", "250")),
  faucetEth: env("FAUCET_ETH", local ? "1" : "0.0005")!,

  // 0G: inference via the Router (OpenAI-compatible), evidence on 0G Storage.
  zgRouterUrl: env("ZG_ROUTER_URL", "https://router-api.0g.ai/v1")!,
  zgApiKey: env("ZG_API_KEY"),
  zgModel: env("ZG_MODEL", "claude-haiku-5.5")!,
  zgDailyCapUsd: Number(env("ZG_DAILY_CAP_USD", "5")),
  zgStorageRpc: env("ZG_STORAGE_RPC", "https://evmrpc-testnet.0g.ai")!,
  zgIndexer: env("ZG_INDEXER", "https://indexer-storage-testnet-turbo.0g.ai")!,
  zgStorageKey: env("ZG_STORAGE_PRIVATE_KEY"),

  // World ID (IDKit 4). Without these, the engine offers a clearly labelled dev verifier.
  worldAppId: env("WORLD_APP_ID"),
  worldRpId: env("WORLD_RP_ID"),
  worldSigningKey: env("WORLD_RP_SIGNING_KEY"),
  worldAction: env("WORLD_ACTION", "clutch-human-pass")!,
  worldEnvironment: env("WORLD_ENVIRONMENT", "staging") as "production" | "staging",
  passTtlSec: Number(env("PASS_TTL_SEC", "43200")),
  passDailyCapUsdc: Number(env("PASS_DAILY_CAP_USDC", "100")),

  // Lichess OAuth (PKCE; no registration needed) for streamers proving they own a Lichess account.
  lichessClientId: env("LICHESS_CLIENT_ID", "clutch.gg")!,
};

for (const [k, v] of Object.entries({ OWNER_PRIVATE_KEY: config.ownerKey, AGENT_PRIVATE_KEY: config.agentKey, PASS_SIGNER_PRIVATE_KEY: config.passSignerKey })) {
  if (!v) throw new Error(`${k} is required on chain ${chainId}`);
}

export const isLocalChain = local;
