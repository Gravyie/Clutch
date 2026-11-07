import type { IncomingMessage, ServerResponse } from "node:http";

export const APP_ORIGIN = "https://try-clutch.vercel.app";

export function browserOriginAllowed(origin: string | undefined, local: boolean): boolean {
  if (origin === APP_ORIGIN) return true;
  if (!local || !origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function applyCors(req: IncomingMessage, res: ServerResponse, local: boolean): boolean {
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  // Health checks and server-to-server clients do not send a browser Origin.
  if (origin !== undefined && !browserOriginAllowed(origin, local)) {
    res.writeHead(403).end("Origin not allowed");
    return false;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return true;
}
