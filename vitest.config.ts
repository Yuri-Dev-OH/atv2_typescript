import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/catalog-server.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 81, statements: 81, functions: 81, branches: 81 },
    },
  },
});
