import { config } from "./config";
import { log } from "./log";
import { Hub } from "./stream/hub";
import { serve } from "./server";

const hub = new Hub();
log.info(
  `Clutch engine · chain ${config.chainId} · AI ${hub.zg.provider}` + (hub.zg.provider === "0g" ? ` (${config.zgModel})` : " (set ZG_API_KEY for 0G inference)"),
);
await hub.boot();
serve(hub);

process.on("unhandledRejection", (e: any) => log.error("unhandled", e?.shortMessage ?? e?.message ?? e));
