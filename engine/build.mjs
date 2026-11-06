import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: ['src/main.ts', 'src/scripts/production-check.ts', 'src/scripts/import-stream.ts'],
  outdir: 'dist', outExtension: { '.js': '.mjs' },
  platform: 'node', target: 'node22', format: 'esm', bundle: true,
  packages: 'external',
  alias: { '@clutch/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  sourcemap: true,
});
