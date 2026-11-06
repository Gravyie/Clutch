import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: {
    main: 'src/main.ts',
    'production-check': 'src/scripts/production-check.ts',
    'import-stream': 'src/scripts/import-stream.ts',
    'role-check': 'src/scripts/role-check.ts',
  },
  outdir: 'dist', outExtension: { '.js': '.mjs' },
  platform: 'node', target: 'node22', format: 'esm', bundle: true,
  packages: 'external',
  alias: { '@clutch/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  sourcemap: true,
});
