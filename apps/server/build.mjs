// Bundle the server (and the workspace packages it uses, which are TypeScript source) into
// dist/. Third-party dependencies stay external and are installed in the runtime image.
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@jaanch/'));

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/main.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, '@electric-sql/pglite/*'],
  // Some CommonJS dependencies call require(); provide it in the ESM bundle.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

// Speech-recognition protocol definitions are read at runtime.
cpSync('../../packages/llm/protos', 'dist/protos', { recursive: true });
