import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Unit + integration tests for every workspace package. Tests that call real external
 * services (SEBI website, NVIDIA NIM, Twilio) live in *.live.test.ts files and only run via
 * `pnpm test:live` (vitest.live.config.ts), never in the default suite.
 */
const nodeProjects = [
  { name: 'core', root: './packages/core' },
  { name: 'sources', root: './packages/sources' },
  { name: 'db', root: './packages/db', testTimeout: 30_000 },
  { name: 'llm', root: './packages/llm' },
  { name: 'server', root: './apps/server', testTimeout: 30_000 },
];
const webConfig = './apps/web/vitest.config.ts';

export default defineConfig({
  test: {
    projects: [
      ...nodeProjects
        .filter((p) => existsSync(p.root))
        .map((p) => ({
          test: {
            name: p.name,
            root: p.root,
            include: ['test/**/*.test.ts'],
            exclude: ['**/*.live.test.ts', '**/node_modules/**'],
            ...(p.testTimeout ? { testTimeout: p.testTimeout } : {}),
          },
        })),
      ...(existsSync(webConfig) ? [webConfig] : []),
    ],
  },
});
