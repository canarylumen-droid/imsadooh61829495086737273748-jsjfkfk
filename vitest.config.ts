import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'dist', '.temp', '.config', '.opencode'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'shared/lib/monitoring/**',
        'shared/lib/crypto/**',
        'shared/lib/redis/**',
        'shared/lib/storage/**',
        'services/api-gateway/src/auth/**',
        'services/api-gateway/src/middleware/**',
        'services/email-service/src/email/**',
        'services/warmup-service/src/engine/**',
      ],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        'node_modules',
        'dist',
      ],
    },
    setupFiles: [],
    testTimeout: 15000,
    hookTimeout: 15000,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@services': path.resolve(__dirname, 'services'),
      '@audnix/shared': path.resolve(__dirname, 'packages/shared/index.ts'),
      '@audnix/core': path.resolve(__dirname, 'packages/core/index.ts'),
    },
  },
});
