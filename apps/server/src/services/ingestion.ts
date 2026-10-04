import type { RegistryCategory } from '@jaanch/core';
import {
  ingestRbiAlertList,
  ingestSebiRegisters,
  RBI_ALERT_SOURCE_ID,
  SEBI_SOURCE_ID,
  SebiClient,
} from '@jaanch/sources';
import type { Runtime } from '../runtime.js';

export type IngestTarget = 'sebi' | 'rbi';

export async function runIngestion(
  rt: Runtime,
  targets: IngestTarget[],
  categories?: RegistryCategory[],
) {
  const out: Record<string, unknown> = {};
  if (targets.includes('sebi')) {
    out.sebi = await ingestSebiRegisters({
      client: new SebiClient(),
      registry: rt.repos.registry,
      snapshots: rt.repos.snapshots,
      logger: rt.logger,
      ...(categories?.length ? { categories } : {}),
    });
  }
  if (targets.includes('rbi')) {
    out.rbi = await ingestRbiAlertList({ repo: rt.repos.alerts, snapshots: rt.repos.snapshots });
  }
  rt.logger.info({ result: out }, 'ingestion finished');
  return out;
}

/**
 * Keep snapshots fresh without a paid cron: on boot, refresh any source whose newest snapshot is
 * missing or older than INGEST_MAX_AGE_HOURS. Runs in the background after the server listens.
 */
export async function ingestOnBootIfNeeded(rt: Runtime): Promise<void> {
  const { config } = rt;
  if (config.SOURCE_MODE === 'fixture' || config.INGEST_ON_BOOT === 'never') return;
  const maxAgeMs = config.INGEST_MAX_AGE_HOURS * 3_600_000;
  const isFresh = async (sourceId: string) => {
    const latest = await rt.repos.snapshots.latestSucceeded(sourceId);
    if (!latest.length) return false;
    const oldest = Math.min(...latest.map((s) => s.completedAt?.getTime() ?? 0));
    return Date.now() - oldest < maxAgeMs;
  };
  const targets: IngestTarget[] = [];
  if (config.INGEST_ON_BOOT === 'always' || !(await isFresh(SEBI_SOURCE_ID))) targets.push('sebi');
  if (config.INGEST_ON_BOOT === 'always' || !(await isFresh(RBI_ALERT_SOURCE_ID)))
    targets.push('rbi');
  if (!targets.length) return;
  rt.logger.info({ targets }, 'refreshing official snapshots in the background');
  await runIngestion(rt, targets);
}
