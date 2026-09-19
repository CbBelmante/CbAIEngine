import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'providers/index': 'src/providers/index.ts',
    'middleware/index': 'src/middleware/index.ts',
    'observability/index': 'src/observability/index.ts',
    'dbAdapter/index': 'src/dbAdapter/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
  treeshake: true,
  outDir: 'dist',
});
