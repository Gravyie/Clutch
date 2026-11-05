import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { HumanPassGateAbi, fromUsdc, toUsdc } from "@clutch/shared";
import { config } from "./config";
import { publicClient } from "./chain";
import { one, run } from "./db";

/**
 * The human-pass signer.
 *
 * The trust moment: putting money on a live outcome. The minimum sufficient credential proves a unique human (so
 * limits and self-exclusion follow the person, not the wallet) and, where available, 18+. We request the Passport
 * credential (NFC chip, unique document holder) and Identity Check's `minimum_age: 18` where World has enabled it.
 * Nothing else about the person is collected.
 *
 * After server-side verification we sign a short-lived EIP-712 HumanPass {wallet, nullifier, expiry, dailyCap}, which
 * the HumanPassGate contract checks on every trade.
 */

const signer = privateKeyToAccount(config.passSignerKey);
const d = config.deployment;

export const worldConfigured = Boolean(config.worldAppId && config.worldRpId && config.worldSigningKey);

/** Dev verifier personas (local and testnets without World credentials). The streamer persona owns the replay channel. */
export const DEV_PERSONAS = ["alice", "bob", "streamer", "minor"] as const;
export const devNullifier = (persona: string) => BigInt(keccak256(toBytes(`clutch-dev-human:${persona}`))).toString();

export class PassRefused extends Error {
  status = 403;
  constructor(readonly code: "under_age" | "self_excluded" | "verification_failed", message: string) {
    super(message);
  }
}

/** Step 1: sign the IDKit request on the server (the signing key never reaches the client). */
export function rpContext() {
  if (!worldConfigured) return { dev: true as const, personas: DEV_PERSONAS };
  const s = signRequest({ signingKeyHex: config.worldSigningKey!, action: config.worldAction });
  return {
    dev: false as const,
    app_id: config.worldAppId,
    action: config.worldAction,
    environment: config.worldEnvironment,
    rp_context: { rp_id: config.worldRpId, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt, signature: s.sig },
  };
}

/** Step 2: verify the IDKit result with World, then issue a pass bound to this wallet. */
export async function verifyAndIssue(result: any, wallet: `0x${string}`) {
  if (!worldConfigured) throw new PassRefused("verification_failed", "World ID is not configured on this server.");
  if (result?.environment && result.environment !== config.worldEnvironment)
    throw new PassRefused("verification_failed", "Proof was made for a different World ID environment.");
  const res = await fetch(`https://developer.world.org/api/v4/verify/${config.worldRpId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...result, environment: config.worldEnvironment }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.success !== true) throw new PassRefused("verification_failed", body.detail ?? body.code ?? "World ID verification failed.");
  if (body.environment && body.environment !== config.worldEnvironment) throw new PassRefused("verification_failed", "Environment mismatch.");

  const nullifierHex: string = result.nullifier ?? result.responses?.[0]?.nullifier ?? body.nullifier;
  if (!nullifierHex) throw new PassRefused("verification_failed", "No nullifier in the proof.");
  const ageAttested = result.identity_attested ?? body.identity_attested;
  if (ageAttested === false) throw new PassRefused("under_age", "World ID could not confirm you're 18 or older, so trading isn't available.");
  return issue(BigInt(nullifierHex).toString(), wallet, result.identifier ?? "passport", ageAttested === true);
}

/** Dev verifier: clearly labelled in the UI and in the pass (`credential: "dev"`). Exercises every path. */
export async function devIssue(persona: string, wallet: `0x${string}`) {
  if (worldConfigured) throw new PassRefused("verification_failed", "The dev verifier is off because World ID is configured.");
  if (!DEV_PERSONAS.includes(persona as any)) throw new PassRefused("verification_failed", "Unknown persona.");
  if (persona === "minor") throw new PassRefused("under_age", "This credential doesn't meet the 18+ requirement, so trading isn't available.");
  return issue(devNullifier(persona), wallet, "dev", true);
}

/** The human behind a wallet, if they've verified. */
export async function nullifierOf(wallet: string) {
  return (await one<{ nullifier: string }>(`SELECT nullifier FROM human_wallets WHERE address = ?`, [wallet.toLowerCase()]))?.nullifier;
}

async function issue(nullifier: string, wallet: `0x${string}`, credential: string, ageVerified: boolean) {
  const until = Number(await publicClient.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "excludedUntil", args: [BigInt(nullifier)] }));
  if (until > Date.now() / 1000) throw new PassRefused("self_excluded", `This person is taking a break until ${new Date(until * 1000).toUTCString()}.`);

  await run(
    `INSERT INTO humans (nullifier, credential, age_verified, verified_at) VALUES (?,?,?,?)
     ON CONFLICT(nullifier) DO UPDATE SET verified_at = excluded.verified_at, credential = excluded.credential`,
    [nullifier, credential, ageVerified ? 1 : 0, Date.now()],
  );
  await run(`INSERT INTO human_wallets (address, nullifier, linked_at) VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET nullifier = excluded.nullifier, linked_at = excluded.linked_at`, [
    wallet.toLowerCase(),
    nullifier,
    Date.now(),
  ]);

  const pass = {
    trader: wallet,
    nullifier: BigInt(nullifier),
    expiry: BigInt(Math.floor(Date.now() / 1000) + config.passTtlSec),
    dailyCap: fromUsdc(config.passDailyCapUsdc),
  };
  const signature = await signer.signTypedData({
    domain: { name: "Clutch Human Pass", version: "1", chainId: config.chainId, verifyingContract: d.humanPassGate },
    types: { HumanPass: [{ name: "trader", type: "address" }, { name: "nullifier", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "dailyCap", type: "uint128" }] },
    primaryType: "HumanPass",
    message: pass,
  });
  const gateData = encodeAbiParameters(
    [{ type: "tuple", components: [{ name: "trader", type: "address" }, { name: "nullifier", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "dailyCap", type: "uint128" }] }, { type: "bytes" }],
    [pass, signature],
  );
  return { gateData: gateData as Hex, nullifier, expiry: Number(pass.expiry), dailyCap: config.passDailyCapUsdc, credential, dev: credential === "dev" };
}

export async function limits(nullifier: string) {
  const [staked, until] = await Promise.all([
    publicClient.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "stakedToday", args: [BigInt(nullifier)] }),
    publicClient.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "excludedUntil", args: [BigInt(nullifier)] }),
  ]);
  return { stakedToday: toUsdc(staked), cap: config.passDailyCapUsdc, excludedUntil: Number(until) };
}
