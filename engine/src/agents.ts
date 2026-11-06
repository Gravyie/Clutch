import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { isAddress, getAddress } from "viem";
import { config, isLocalChain } from "./config";
import { all, one, run } from "./db";
import { log } from "./log";
import { nullifierOf, signPass } from "./pass";

/**
 * World ID Agent Pass: a trading agent acts for exactly one verified human, inside that human's limits.
 *
 * The protected action is "let this agent trade with my identity". It needs a fresh World ID approval through the
 * World IdP (OIDC device authorization grant, `max_age=0`, Orb assurance). The human scans a QR code from the
 * Clutch web app and approves in World App, and the backend validates the ID token (signature, issuer, audience,
 * expiry, `acr`, `auth_time` after the attempt started). Only then does it sign a HumanPass for the agent's wallet
 * carrying the *human's* nullifier, so the onchain daily cap is shared: the agent can never spend past what the
 * person could. A denied, expired or mismatched approval issues nothing.
 *
 * Agent passes are short-lived (1h) and renewed by the engine while the grant is active (24h), so revoking takes
 * effect within the hour; raising the cap or renewing after 24h is a new human checkpoint.
 */

export const agentPassConfigured = Boolean(config.worldIdpClientId);
/** Local chain without World IdP credentials: a labelled dev approval stands in for World App. Never on a testnet. */
export const agentPassDev = !agentPassConfigured && isLocalChain;
const PASS_TTL = 3600;

type Attempt = {
  id: string;
  owner: `0x${string}`;
  nullifier: string;
  agent: `0x${string}`;
  name: string;
  capUsdc: number;
  deviceCode: string;
  startedAt: number;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
  status: "pending" | "approved" | "denied" | "expired";
  reason?: string;
  dev?: { decision?: boolean };
};

const attempts = new Map<string, Attempt>();

export class AgentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let discovery: Promise<{ device_authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }> | undefined;
const disco = () => (discovery ??= fetch(`${config.worldIdpIssuer}/.well-known/openid-configuration`).then((r) => r.json() as any));
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function clientAuth(body: URLSearchParams) {
  body.set("client_id", config.worldIdpClientId!);
  if (config.worldIdpClientSecret) body.set("client_secret", config.worldIdpClientSecret);
  return body;
}

/** Step 1 (human, signed in): ask World IdP for a device code the human approves in World App. */
export async function startAuthorization(owner: `0x${string}`, input: { agent?: string; name?: string; capUsdc?: number }) {
  if (!agentPassConfigured && !agentPassDev) throw new AgentError(503, "Agent Pass isn't configured on this server (WORLD_IDP_CLIENT_ID).");
  if (!input.agent || !isAddress(input.agent)) throw new AgentError(400, "Paste the agent's wallet address (it starts with 0x).");
  const agent = getAddress(input.agent);
  if (agent.toLowerCase() === owner.toLowerCase()) throw new AgentError(400, "That's your own wallet. An agent needs its own address.");
  const nullifier = await nullifierOf(owner);
  if (!nullifier) throw new AgentError(403, "Verify with World ID first. An agent can only act for a verified person.");
  const capUsdc = Math.max(1, Math.min(Number(input.capUsdc) || 20, config.passDailyCapUsdc));
  const name = String(input.name ?? "My agent").slice(0, 40) || "My agent";

  if (agentPassDev) {
    const a: Attempt = { id: randomBytes(12).toString("hex"), owner, nullifier, agent, name, capUsdc, deviceCode: "dev", startedAt: Math.floor(Date.now() / 1000), expiresAt: Date.now() + 600_000, interval: 1, nextPollAt: 0, status: "pending", dev: {} };
    attempts.set(a.id, a);
    return { attempt: a.id, userCode: "DEV", verificationUri: "", verificationUriComplete: "", expiresAt: a.expiresAt, agent, capUsdc, dev: true };
  }

  const d = await disco();
  const claims = { id_token: { acr: { essential: true, values: config.worldIdpAcr } } };
  const res = await fetch(d.device_authorization_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: clientAuth(new URLSearchParams({ scope: "openid", max_age: "0", claims: JSON.stringify(claims) })),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new AgentError(502, `World IdP refused the request: ${body.error_description ?? body.error ?? res.status}`);

  const a: Attempt = {
    id: randomBytes(12).toString("hex"),
    owner,
    nullifier,
    agent,
    name,
    capUsdc,
    deviceCode: body.device_code,
    startedAt: Math.floor(Date.now() / 1000),
    expiresAt: Date.now() + Number(body.expires_in ?? 600) * 1000,
    interval: Number(body.interval ?? 5),
    nextPollAt: 0,
    status: "pending",
  };
  attempts.set(a.id, a);
  return {
    attempt: a.id,
    userCode: body.user_code as string,
    verificationUri: body.verification_uri as string,
    verificationUriComplete: (body.verification_uri_complete ?? body.verification_uri) as string,
    expiresAt: a.expiresAt,
    agent,
    capUsdc,
  };
}

/** Step 2 (polled by the web app): redeem the device code once the human has approved, then validate everything. */
export async function pollAuthorization(owner: `0x${string}`, id: string) {
  const a = attempts.get(id);
  if (!a || a.owner.toLowerCase() !== owner.toLowerCase()) throw new AgentError(404, "No such authorization.");
  if (a.status !== "pending") return view(a);
  if (Date.now() > a.expiresAt) return finish(a, "expired", "The approval window closed before World ID was approved. No pass was issued.");
  if (Date.now() < a.nextPollAt) return view(a);
  if (a.dev) {
    if (a.dev.decision === undefined) return view(a);
    if (!a.dev.decision) return finish(a, "denied", "The approval was declined. The agent was not authorized.");
    return grant(a, "dev", `dev:${a.nullifier}`, Math.floor(Date.now() / 1000));
  }
  a.nextPollAt = Date.now() + a.interval * 1000;

  const d = await disco();
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: clientAuth(new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: a.deviceCode })),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    switch (body.error) {
      case "authorization_pending":
        return view(a);
      case "slow_down":
        a.interval += 5;
        return view(a);
      case "access_denied":
        return finish(a, "denied", "The approval was declined in World App. The agent was not authorized.");
      case "expired_token":
        return finish(a, "expired", "The approval code expired. No pass was issued.");
      case "unmet_authentication_requirements":
        return finish(a, "denied", "This World ID isn't Orb-verified, which agents need here.");
      default:
        return finish(a, "denied", `World IdP returned ${body.error ?? res.status}. No pass was issued.`);
    }
  }

  // Validate the ID token ourselves; never trust the client.
  let claims: JWTPayload & { acr?: string; auth_time?: number };
  try {
    jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
    ({ payload: claims } = await jwtVerify(body.id_token, jwks, { issuer: d.issuer, audience: config.worldIdpClientId! }));
  } catch (e: any) {
    return finish(a, "denied", `The ID token didn't validate (${e.code ?? e.message}). No pass was issued.`);
  }
  if (!claims.acr || !config.worldIdpAcr.includes(claims.acr)) return finish(a, "denied", "The approval wasn't made with an accepted World ID (Orb).");
  if (!claims.auth_time || claims.auth_time < a.startedAt - 5) return finish(a, "denied", "The approval wasn't fresh. Approve again in World App.");
  if (!claims.iss || !claims.sub) return finish(a, "denied", "The ID token has no subject. No pass was issued.");

  return grant(a, claims.iss, claims.sub, claims.auth_time, claims.acr);
}

/** Dev stand-in for World App (local chain only): approve or decline a pending attempt. */
export function devDecide(owner: `0x${string}`, id: string, approve: boolean) {
  const a = attempts.get(id);
  if (!a?.dev || a.owner.toLowerCase() !== owner.toLowerCase()) throw new AgentError(404, "No such dev authorization.");
  a.dev.decision = approve;
  return pollAuthorization(owner, id);
}

async function grant(a: Attempt, iss: string, sub: string, authTime: number, acr?: string) {
  const claims = { iss, sub, auth_time: authTime, acr: acr ?? "dev" };
  // Bind the World IdP account to this person on first use; afterwards only the same account can authorize agents.
  const linked = await one<{ nullifier: string }>(`SELECT nullifier FROM idp_links WHERE iss = ? AND sub = ?`, [claims.iss, claims.sub]);
  const mine = await one<{ sub: string }>(`SELECT sub FROM idp_links WHERE nullifier = ?`, [a.nullifier]);
  if (linked && linked.nullifier !== a.nullifier) return finish(a, "denied", "This World ID already authorizes agents for a different Clutch account.");
  if (!linked && mine) return finish(a, "denied", "That's a different World ID from the one you linked before. Use the same one.");
  if (!linked) await run(`INSERT INTO idp_links (iss, sub, nullifier, linked_at) VALUES (?,?,?,?)`, [claims.iss, claims.sub, a.nullifier, Date.now()]);

  // The protected action: a pass for the agent's wallet, bound to the human's nullifier and capped.
  const pass = await signPass(a.agent, a.nullifier, a.capUsdc, PASS_TTL);
  await run(
    `INSERT INTO agents (address, nullifier, owner, name, cap_usdc, pass, expires_at, authorized_at, auth_time, acr, revoked_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(address) DO UPDATE SET nullifier = excluded.nullifier, owner = excluded.owner, name = excluded.name, cap_usdc = excluded.cap_usdc,
       pass = excluded.pass, expires_at = excluded.expires_at, authorized_at = excluded.authorized_at, auth_time = excluded.auth_time, acr = excluded.acr, revoked_at = NULL`,
    [a.agent.toLowerCase(), a.nullifier, a.owner.toLowerCase(), a.name, a.capUsdc, JSON.stringify(pass), Date.now() + config.agentPassTtlSec * 1000, Date.now(), claims.auth_time, claims.acr],
  );
  log.info(`agent ${a.agent} authorized by ${a.owner} (cap $${a.capUsdc})`);
  return finish(a, "approved");
}

function finish(a: Attempt, status: Attempt["status"], reason?: string) {
  a.status = status;
  a.reason = reason;
  setTimeout(() => attempts.delete(a.id), 10 * 60_000);
  return view(a);
}

const view = (a: Attempt) => ({ attempt: a.id, status: a.status, reason: a.reason, agent: a.agent, capUsdc: a.capUsdc, expiresAt: a.expiresAt, dev: Boolean(a.dev) });

type AgentRow = { address: string; nullifier: string; owner: string; name: string; cap_usdc: number; pass: string | null; expires_at: number; authorized_at: number; revoked_at: number | null };

/** The agent fetches its pass. Passes last an hour; a fresh one is signed while the grant is active. */
export async function agentPass(address: string) {
  const r = await one<AgentRow>(`SELECT * FROM agents WHERE address = ?`, [address.toLowerCase()]);
  if (!r) throw new AgentError(404, "This agent isn't authorized. Ask its owner to approve it with World ID in Clutch.");
  if (r.revoked_at) throw new AgentError(403, "This agent's owner revoked it.");
  if (Date.now() > r.expires_at) throw new AgentError(403, "This agent's authorization expired. Its owner needs to approve it again with World ID.");
  let pass = r.pass ? JSON.parse(r.pass) : undefined;
  if (!pass || pass.expiry < Date.now() / 1000 + 300) {
    pass = await signPass(getAddress(r.address), r.nullifier, r.cap_usdc, PASS_TTL);
    await run(`UPDATE agents SET pass = ? WHERE address = ?`, [JSON.stringify(pass), r.address]);
  }
  return { ...pass, agent: getAddress(r.address), name: r.name, capUsdc: r.cap_usdc, grantExpiresAt: r.expires_at };
}

export async function listAgents(owner: string) {
  const rows = await all<AgentRow>(`SELECT * FROM agents WHERE owner = ? ORDER BY authorized_at DESC`, [owner.toLowerCase()]);
  return rows.map((r) => ({
    address: getAddress(r.address),
    name: r.name,
    capUsdc: r.cap_usdc,
    authorizedAt: r.authorized_at,
    expiresAt: r.expires_at,
    status: r.revoked_at ? "revoked" : Date.now() > r.expires_at ? "expired" : "active",
  }));
}

export async function revokeAgent(owner: string, address: string) {
  const r = await one<AgentRow>(`SELECT owner FROM agents WHERE address = ?`, [address.toLowerCase()]);
  if (!r || r.owner !== owner.toLowerCase()) throw new AgentError(404, "No such agent.");
  await run(`UPDATE agents SET revoked_at = ?, pass = NULL WHERE address = ?`, [Date.now(), address.toLowerCase()]);
  return { ok: true };
}
