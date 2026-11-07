import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWorldRpId } from "./world-config";

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
if (process.env.NODE_ENV === "production" && chainId !== 84532) throw new Error("Production requires Base Sepolia chain 84532");

/** Lichess TV channels Clutch runs as house streams. Streamers add their own channels from the studio. */
export const HOUSE_CHANNELS = [
  { slug: "blitz", channel: "blitz", title: "Lichess Blitz", subtitle: "Top blitz game, live" },
  { slug: "bullet", channel: "bullet", title: "Lichess Bullet", subtitle: "Top bullet game, live" },
  { slug: "rapid", channel: "rapid", title: "Lichess Rapid", subtitle: "Top rapid game, live" },
  { slug: "classical", channel: "classical", title: "Lichess Classical", subtitle: "Top classical game, live" },
];

/**
 * House video channels: well-known channels across categories, probed for liveness. Streamers add their own from the
 * studio. With TWITCH_CLIENT_ID/SECRET the engine could discover live channels by category instead.
 */
export const VIDEO_SEEDS = (process.env.VIDEO_CHANNELS ??
  "twitch:eslcs,twitch:blastpremier,twitch:pgl,twitch:ohnepixel,twitch:valorant,twitch:tarik,twitch:riotgames,twitch:caedrel,twitch:fortnite,twitch:clix,twitch:rocketleague,kick:xqc,kick:adinross")
  .split(",")
  .filter(Boolean);

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
  twitchLatencyBufferSec: Number(env("TWITCH_LATENCY_BUFFER_SEC", "10")),
  tradingSec: Number(env("TRADING_SEC", "20")),
  // Arrival timestamps cannot prove Twitch's source latency; enforce local observation freshness separately.
  videoCaptureIntervalMs: Number(env("VIDEO_CAPTURE_INTERVAL_MS", "2000")),
  videoMaxFrameAgeMs: Number(env("VIDEO_MAX_FRAME_AGE_MS", "10000")),
  videoMaxSampleGapMs: Number(env("VIDEO_MAX_SAMPLE_GAP_MS", "8000")),
  videoSampleIntervalMs: Number(env("VIDEO_SAMPLE_INTERVAL_MS", "4000")),
  videoTemplateCooldownMs: Number(env("VIDEO_TEMPLATE_COOLDOWN_MS", "60000")),
  videoBoundaryToleranceMs: Number(env("VIDEO_BOUNDARY_TOLERANCE_MS", "2500")),
  videoTradingSec: Number(env("VIDEO_TRADING_SEC", "15")),
  cooldownSec: Number(env("COOLDOWN_SEC", "8")),
  liquidityB: Number(env("MARKET_B_USDC", "80")),
  /** free test funds: a one-time top-up per new wallet, and a daily refill per verified human (World ID) */
  faucetStarterUsdc: Number(env("FAUCET_STARTER_USDC", "25")),
  faucetHumanDailyUsdc: Number(env("FAUCET_HUMAN_DAILY_USDC", "100")),
  /** per network address per day (a venue shares one IP, so these are high) */
  starterPerIpDaily: Number(env("STARTER_PER_IP_DAILY", "200")),
  faucetPerIpDaily: Number(env("FAUCET_PER_IP_DAILY", "300")),
  faucetEth: env("FAUCET_ETH", local ? "0.003" : "0.0005")!, // gas only: the free money is the USDC

  // 0G: inference via the Router (OpenAI-compatible), evidence on 0G Storage.
  zgRouterUrl: env("ZG_ROUTER_URL", "https://router-api.0g.ai/v1")!,
  zgApiKey: env("ZG_API_KEY"),
  zgModel: env("ZG_MODEL", "claude-haiku-5.5")!,
  zgDailyCapUsd: Number(env("ZG_DAILY_CAP_USD", "5")),
  zgVisionModel: env("ZG_VISION_MODEL", "claude-haiku-5.5")!,
  /** Reader B: a different model family (0G's own model), checking only the counters a market depends on. */
  zgVerifyModel: env("ZG_VERIFY_MODEL", "0gm-1.0-35b-a3b")!,
  /** reader B and its fallbacks when a 0G provider is down; none of them is reader A's model family */
  zgVerifyModels: (env("ZG_VERIFY_MODELS", "0gm-1.0-35b-a3b,gemini-2.5-flash-lite") ?? "").split(",").filter(Boolean),
  maxVideoStreams: Number(env("MAX_VIDEO_STREAMS", "3")),
  zgStorageRpc: env("ZG_STORAGE_RPC", "https://evmrpc-testnet.0g.ai")!,
  zgIndexer: env("ZG_INDEXER", "https://indexer-storage-testnet-turbo.0g.ai")!,
  zgStorageKey: env("ZG_STORAGE_PRIVATE_KEY"),

  // World ID (IDKit 4). Without these, the engine offers a clearly labelled dev verifier.
  worldAppId: env("WORLD_APP_ID"),
  /** World ID Agent Pass (World IdP, OIDC). Register a client at auth.world.org/portal with the device grant enabled. */
  worldIdpIssuer: env("WORLD_IDP_ISSUER", "https://auth.world.org")!,
  worldIdpClientId: env("WORLD_IDP_CLIENT_ID"),
  worldIdpClientSecret: env("WORLD_IDP_CLIENT_SECRET"),
  /** accepted authentication classes for authorizing an agent */
  worldIdpAcr: (env("WORLD_IDP_ACR", "https://world.org/oidc/acr/orb") ?? "").split(",").filter(Boolean),
  agentPassTtlSec: Number(env("AGENT_PASS_TTL_SEC", "86400")),
  worldRpId: normalizeWorldRpId(env("WORLD_RP_ID")),
  worldSigningKey: env("WORLD_RP_SIGNING_KEY"),
  worldAction: env("WORLD_ACTION", "clutch-human-pass")!,
  worldEnvironment: env("WORLD_ENVIRONMENT", "staging") as "production" | "staging",
  passTtlSec: Number(env("PASS_TTL_SEC", "43200")),
  passDailyCapUsdc: Number(env("PASS_DAILY_CAP_USDC", "100")),
  /** daily cap for a wallet that hasn't verified with World ID */
  starterDailyCapUsdc: Number(env("STARTER_DAILY_CAP_USDC", "10")),

  // Lichess OAuth (PKCE; no registration needed) for streamers proving they own a Lichess account.
  lichessClientId: env("LICHESS_CLIENT_ID", "clutch.gg")!,
};

for (const [k, v] of Object.entries({ AGENT_PRIVATE_KEY: config.agentKey, PASS_SIGNER_PRIVATE_KEY: config.passSignerKey })) {
  if (!v) throw new Error(`${k} is required on chain ${chainId}`);
}

export const isLocalChain = local;

if (process.env.NODE_ENV === "production") {
  if (chainId !== 84532 || config.deployment.chainId !== 84532) throw new Error("Production requires Base Sepolia chain 84532");
  if (config.ownerKey) throw new Error("Do not supply the owner/deployer key to the production engine");
  if (config.authSecret.length < 32 || config.authSecret === "dev-only-secret-change-me" || /REPLACE|CHANGE_ME|YOUR_/i.test(config.authSecret)) throw new Error("Production AUTH_SECRET must have at least 32 characters");
  if (!config.worldAppId || !config.worldRpId || !config.worldSigningKey) throw new Error("Configure World verification before public production startup");
  if (config.replay) throw new Error("Production REPLAY must be 0");
  if (!config.rpcUrl.startsWith("https://")) throw new Error("Production RPC_URL must use HTTPS");
}
