import { defineConfig } from 'vitest/config';

/**
 * Live tests: hit the real SEBI website, RBI page, RDAP and (when keys are configured) NVIDIA
 * NIM. Run deliberately with `pnpm test:live`; they are slow and depend on the network.
 */
export default defineConfig({
  test: {
    name: 'live',
    include: ['packages/*/test/**/*.live.test.ts', 'apps/*/test/**/*.live.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
