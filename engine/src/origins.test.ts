import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { APP_ORIGIN, applyCors, browserOriginAllowed } from "./origins";

test("HTTP and WebSocket origins enforce the deployed allowlist", async () => {
  const server = createServer((req, res) => {
    if (!applyCors(req, res, false)) return;
    res.writeHead(req.method === "OPTIONS" ? 204 : 200).end();
  });
  const wss = new WebSocketServer({ server, verifyClient: ({ origin }, done) => done(browserOriginAllowed(origin, false), 403) });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    for (const origin of [APP_ORIGIN, "https://clutch.rajatsrivastav.dev", "https://evil.example", "http://localhost:3000", "null", APP_ORIGIN + ".evil.example"]) {
      const allowed = origin === APP_ORIGIN;
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const response = await fetch(`http://127.0.0.1:${port}`, { method, headers: { Origin: origin } });
        assert.equal(response.status, allowed ? method === "OPTIONS" ? 204 : 200 : 403);
        assert.equal(response.headers.get("access-control-allow-origin"), allowed ? origin : null);
      }
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
        ws.on("open", () => { ws.close(); allowed ? resolve() : reject(new Error("Disallowed origin connected")); });
        ws.on("unexpected-response", (_req, res) => { res.resume(); ws.terminate(); assert.equal(res.statusCode, 403); allowed ? reject(new Error("Allowed origin rejected")) : resolve(); });
        ws.on("error", () => {});
      });
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
    assert.equal(browserOriginAllowed(undefined, false), false);
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) assert.equal(browserOriginAllowed(origin, true), true);
    assert.equal(browserOriginAllowed("https://evil.example", true), false);
  } finally {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
