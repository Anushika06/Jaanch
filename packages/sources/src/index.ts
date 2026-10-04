import type { Sources } from '@jaanch/core';
import { AlertListRepo, CacheRepo, RegistryRepo, SnapshotsRepo, type Db } from '@jaanch/db';
import { RbiAlertList } from './rbi/alert-list.js';
import { RdapDomains } from './rdap/rdap.js';
import { SebiRegistry } from './sebi/adapter.js';
import { SebiClient } from './sebi/client.js';

export * from './http.js';
export * from './sebi/categories.js';
export * from './sebi/parse.js';
export { SebiClient } from './sebi/client.js';
export {
  ingestSebiRegisters,
  SEBI_SOURCE_ID,
  SEBI_REGISTRY_SOURCE,
  type CategoryIngestResult,
} from './sebi/ingest.js';
export { SebiRegistry } from './sebi/adapter.js';
export {
  RbiAlertList,
  ingestRbiAlertList,
  parseRbiAlertList,
  RBI_ALERT_SOURCE_ID,
  RBI_ALERT_URL,
} from './rbi/alert-list.js';
export { RdapDomains, parseRdap } from './rdap/rdap.js';
export { FIXTURE_REGISTRY, FIXTURE_ALERTS, loadFixtures } from './fixtures.js';

export interface SourcesConfig {
  /** Confirm snapshot misses against SEBI's live search (recommended in production). */
  liveLookups: boolean;
  /** Query RDAP for domain registration dates. */
  rdap: boolean;
  staleAfterHours?: number;
}

/** Wire every source adapter to the database. */
export function createSources(db: Db, config: SourcesConfig): Sources {
  const cache = new CacheRepo(db);
  const snapshots = new SnapshotsRepo(db);
  const registry = new SebiRegistry({
    registry: new RegistryRepo(db),
    snapshots,
    cache,
    client: config.liveLookups ? new SebiClient() : null,
    ...(config.staleAfterHours ? { staleAfterHours: config.staleAfterHours } : {}),
  });
  const rdap = new RdapDomains(cache);
  return {
    registry,
    alertList: new RbiAlertList(new AlertListRepo(db), snapshots),
    domains: config.rdap
      ? rdap
      : {
          async lookup(domain) {
            const now = new Date().toISOString();
            return {
              status: 'unavailable',
              domain,
              registeredOn: null,
              registrar: null,
              access: {
                mode: 'live',
                asOf: null,
                retrievedAt: now,
                stale: false,
                isFixture: false,
              },
              rdapUrl: null,
              error: 'disabled',
            };
          },
        },
  };
}
