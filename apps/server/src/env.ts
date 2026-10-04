import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Load `.env` for local development. Searches the working directory and its parents (the repo
 * root holds `.env` while pnpm runs scripts from apps/server). Real environment variables win;
 * hosted deployments set variables in the provider's dashboard and ship no .env file.
 */
export function loadEnvFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      loadDotenv({ path: file, override: false, quiet: true });
      return file;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
