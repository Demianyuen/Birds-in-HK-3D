import { build } from 'esbuild';

await build({
  entryPoints: ['server/main.ts'],
  outfile: 'dist-server/world.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});
