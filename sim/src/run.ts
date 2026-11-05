/**
 * Reproducible Blackout Guard evaluation. Writes sim/out/results.md and sim/out/results.json.
 * Usage: pnpm sim
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT, runCompetitive, runStochastic, runWithholding, schedules, type Outcome } from "./model";

const out = join(dirname(fileURLToPath(import.meta.url)), "../out");
mkdirSync(out, { recursive: true });

const JUMPS = [0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2];
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const rows: Record<string, Record<string, Outcome[]>> = {};

let md = `# Blackout Guard: simulated recovery outcomes\n\n`;
md += `Full-range CPMM, TVL ${money(DEFAULT.tvlUsd)}, ETH ${DEFAULT.p0}, gas $${DEFAULT.gasUsd.toFixed(2)}/trade, ${DEFAULT.blocks} blocks after recovery (2 s blocks: 900 ≈ 30 min). `;
md += `Noise flow ${money(DEFAULT.noiseVolumePerBlock)}/block at 0.3%, participation e^(−Δfee/1%).\n\n`;
md += `These are model outputs under stated assumptions, not observed returns.\n\n`;

// Sanity check against the reference numbers: $4M pool, 2000 → 2100 (+5%), zero fee arb ≈ $1,220.
const ref = runCompetitive(schedules()[0], { ...DEFAULT, jump: 0.05, gasUsd: 0 });
md += `Reference check: zero-fee arbitrage on a +5% jump = **${money(ref.arbProfit)}** (analytic LVR for this pool: $1,220).\n\n`;

for (const [mode, run] of [
  ["Competitive arbitrage (auction works)", (sch: any, s: any) => runCompetitive(sch, s)],
  ["Stochastic entry, q = 0.2 per block", (sch: any, s: any) => runStochastic(sch, s, 0.2)],
  ["Withholding monopolist (auction fails)", (sch: any, s: any) => runWithholding(sch, s)],
] as const) {
  md += `## ${mode}\n\n| Schedule | ${JUMPS.map((j) => `${(j * 100).toFixed(1)}% jump: LP fees / arb`).join(" | ")} |\n|---|${JUMPS.map(() => "---:").join("|")}|\n`;
  rows[mode] = {};
  for (const sch of schedules()) {
    const cells = JUMPS.map((jump) => run(sch, { ...DEFAULT, jump }));
    rows[mode][sch.name] = cells;
    md += `| ${sch.name} | ${cells.map((c) => `${money(c.lpFees)} / ${money(c.arbProfit)}`).join(" | ")} |\n`;
  }
  md += `\n`;
}

md += `## Cost to ordinary traders (competitive case, 5% jump)\n\n| Schedule | First arb block | Residual mispricing | Noise-trader fees forgone |\n|---|---:|---:|---:|\n`;
for (const sch of schedules()) {
  const o = runCompetitive(sch, { ...DEFAULT, jump: 0.05 });
  md += `| ${sch.name} | ${o.firstTradeBlock ?? "—"} | ${(o.residualMispricing * 100).toFixed(2)}% | ${money(o.noiseFeesLost)} |\n`;
}

md += `\n## Reading the results\n\n`;
md += `- With competing arbitrageurs, a short, steep, block-anchored auction captures most of the jump as LP fees, because the first profitable trade happens near the highest fee the jump can bear.\n`;
md += `- Against a lone arbitrageur who can wait, every descending schedule degrades toward its floor. The block-anchored auction ends in ${40} blocks, so its downside is short; the original 30-minute schedule keeps a 3% surcharge on ordinary traders for far longer.\n`;
md += `- Small jumps (≤ 0.5%) sit inside even the base-fee band; the guard neither helps nor hurts much there.\n`;

writeFileSync(join(out, "results.md"), md);
writeFileSync(join(out, "results.json"), JSON.stringify({ scenario: DEFAULT, jumps: JUMPS, rows }, null, 1));
console.log(md);
