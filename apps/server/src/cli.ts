/**
 * Jaanch operations CLI.
 *
 *   pnpm --filter @jaanch/server cli migrate
 *   pnpm --filter @jaanch/server cli ingest [sebi|rbi|all] [--categories=RA,IA]
 *   pnpm --filter @jaanch/server cli fixtures          (load FICTIONAL dev data)
 *   pnpm --filter @jaanch/server cli sweep
 *   pnpm --filter @jaanch/server cli status
 *   pnpm --filter @jaanch/server cli investigate "message text" [--locale=hi]
 */
import { buildReportView, type RegistryCategory } from '@jaanch/core';
import { migrate, sweepExpired } from '@jaanch/db';
import { loadFixtures } from '@jaanch/sources';
import { loadConfig } from './config.js';
import { newInvestigationId } from './crypto.js';
import { loadEnvFile } from './env.js';
import { createLogger } from './logger.js';
import { createRuntime } from './runtime.js';
import { runIngestion, type IngestTarget } from './services/ingestion.js';
import { sourcesStatus } from './services/status.js';

async function main() {
  loadEnvFile();
  const [command = 'help', ...rest] = process.argv.slice(2);
  const flags = Object.fromEntries(
    rest.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=') as [string, string]),
  );
  const args = rest.filter((a) => !a.startsWith('--'));

  const config = loadConfig({ ...process.env, WORKER_ENABLED: 'false' });
  const logger = createLogger(
    config.LOG_LEVEL === 'silent' ? 'silent' : 'info',
    process.stdout.isTTY,
  );
  const rt = await createRuntime(config, logger);
  try {
    switch (command) {
      case 'migrate':
        console.log('migrations applied:', await migrate(rt.db));
        break;
      case 'ingest': {
        const which = (args[0] ?? 'all') as IngestTarget | 'all';
        const targets: IngestTarget[] = which === 'all' ? ['sebi', 'rbi'] : [which];
        const categories = flags.categories
          ? (flags.categories.split(',') as RegistryCategory[])
          : undefined;
        console.log(JSON.stringify(await runIngestion(rt, targets, categories), null, 2));
        break;
      }
      case 'fixtures':
        await loadFixtures({
          registry: rt.repos.registry,
          snapshots: rt.repos.snapshots,
          alerts: rt.repos.alerts,
        });
        console.log('Loaded FICTIONAL fixture data (marked as fixtures in every report).');
        break;
      case 'sweep':
        console.log(await sweepExpired(rt.db));
        break;
      case 'status':
        console.log(JSON.stringify(await sourcesStatus(rt), null, 2));
        break;
      case 'investigate': {
        const text = args.join(' ');
        if (!text) throw new Error('usage: investigate "message text"');
        const locale = flags.locale === 'hi' ? 'hi' : 'en';
        const report = await rt.engine.run(
          { channel: 'api', locale, parts: [{ kind: 'text', text }] },
          { id: newInvestigationId(), createdAt: new Date(), locale },
        );
        const view = buildReportView(report, locale);
        console.log(`\n${view.headline}\n`);
        for (const c of view.claims)
          console.log(`[${c.verdictLabel}] ${c.statement}\n   ${c.explanation}\n`);
        for (const f of view.findings) console.log(`(${f.severityLabel}) ${f.text}`);
        console.log('\nCould not check:');
        for (const u of view.unchecked) console.log(` - ${u.text}`);
        break;
      }
      default:
        console.log(
          'commands: migrate | ingest [sebi|rbi|all] [--categories=RA,IA] | fixtures | sweep | status | investigate "text" [--locale=hi]',
        );
    }
  } finally {
    await rt.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
