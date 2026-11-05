import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage, isAddress } from "viem";
import { config } from "./config";

/**
 * Wallet sign-in. The client signs a one-time message with its wallet (embedded or external); we verify it and issue
 * a short HMAC token. Used for off-chain account actions (studio, profile). Everything involving money is
 * authorised onchain by the wallet itself, never by this token.
 */

const nonces = new Map<string, number>();
const TTL = 7 * 24 * 3600;

export function newNonce() {
  const n = randomBytes(12).toString("hex");
  nonces.set(n, Date.now() + 5 * 60_000);
  for (const [k, exp] of nonces) if (exp < Date.now()) nonces.delete(k);
  return n;
}

export const signInMessage = (address: string, nonce: string) =>
  `Sign in to Clutch\n\nThis proves you own this wallet. It costs nothing and sends no transaction.\n\nAddress: ${address}\nChain: ${config.chainId}\nNonce: ${nonce}`;

export async function signIn(address: string, nonce: string, signature: `0x${string}`) {
  if (!isAddress(address)) throw new AuthError("invalid address");
  const exp = nonces.get(nonce);
  if (!exp || exp < Date.now()) throw new AuthError("sign-in expired, try again");
  nonces.delete(nonce);
  const ok = await verifyMessage({ address, message: signInMessage(address, nonce), signature });
  if (!ok) throw new AuthError("signature does not match wallet");
  return issue(address.toLowerCase());
}

function issue(address: string) {
  const body = Buffer.from(JSON.stringify({ a: address, e: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  return `${body}.${createHmac("sha256", config.authSecret).update(body).digest("base64url")}`;
}

export function verifyToken(header?: string): `0x${string}` {
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthError("sign in first");
  const [body, mac] = token.split(".");
  const want = createHmac("sha256", config.authSecret).update(body ?? "").digest();
  const got = Buffer.from(mac ?? "", "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AuthError("invalid session");
  const { a, e } = JSON.parse(Buffer.from(body, "base64url").toString());
  if (e < Date.now() / 1000) throw new AuthError("session expired");
  return a;
}

export class AuthError extends Error {
  status = 401;
}
