import { config } from "./config";
import { log } from "./log";
import { Hub } from "./stream/hub";
import { serve } from "./server";
import { ZeroG } from "./ai/zeroG";

if (process.env.NODE_ENV === "production") {
  const { checkProductionDeployment } = await import("./production");
  try { await checkProductionDeployment(); }
  catch { log.error("Production preflight failed: check RPC, manifest and separated runtime roles. No transaction was sent."); process.exit(1); }
}

await ZeroG.loadSwitch(); // the operator's AI on/off, persisted across restarts

const hub = new Hub();
log.info(
  `Clutch engine · chain ${config.chainId} · AI ${hub.zg.provider}` + (hub.zg.provider === "0g" ? ` (${config.zgModel})` : " (set ZG_API_KEY for 0G inference)") + (ZeroG.enabled ? "" : " · AI SWITCHED OFF (pnpm ai on)"),
);
await hub.boot();
serve(hub);

process.on("unhandledRejection", (e: any) => log.error("unhandled", e?.shortMessage ?? e?.message ?? e));

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  for (const runner of hub.runners.values()) runner.stop();
  // Persisted active markets follow the existing safe restore/VOID path on restart.
  setTimeout(() => process.exit(0), 1000).unref();
  setTimeout(() => process.exit(0), 1500);
});
