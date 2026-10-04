/**
 * LIVE tests against the real official sources. Run with `pnpm test:live`. They verify that the
 * production adapters still work with SEBI's, RBI's and RDAP's current responses.
 */
import {
  AlertListRepo,
  CacheRepo,
  migrate,
  openDb,
  RegistryRepo,
  SnapshotsRepo,
  type Db,
} from '@jaanch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ingestRbiAlertList,
  ingestSebiRegisters,
  RbiAlertList,
  RdapDomains,
  SebiClient,
  SebiRegistry,
} from '../src/index.js';

let db: Db;
beforeAll(async () => {
  db = await openDb();
  await migrate(db);
});
afterAll(async () => {
  await db.close();
});

describe('SEBI (live)', () => {
  it('looks up a real registration number on the live register', async () => {
    const reg = new SebiRegistry({
      registry: new RegistryRepo(db),
      snapshots: new SnapshotsRepo(db),
      cache: new CacheRepo(db),
      client: new SebiClient(),
    });
    const r = await reg.lookupByNumber('INH000011431');
    expect(r.status).toBe('found');
    expect(r.access.mode).toBe('live');
    expect(r.records[0]!.category).toBe('RA');
    const none = await reg.lookupByNumber('INH000099999');
    expect(none.status).toBe('not_found');
  });

  it('ingests a register category from the official Excel export', async () => {
    const results = await ingestSebiRegisters({
      client: new SebiClient(),
      registry: new RegistryRepo(db),
      snapshots: new SnapshotsRepo(db),
      categories: ['MF', 'RTA'],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.find((r) => r.category === 'MF')!.records).toBeGreaterThan(40);
    expect(results[0]!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('RBI Alert List (live)', () => {
  it('ingests the current list', async () => {
    const r = await ingestRbiAlertList({
      repo: new AlertListRepo(db),
      snapshots: new SnapshotsRepo(db),
    });
    expect(r.ok).toBe(true);
    expect(r.entries).toBeGreaterThan(50);
    const list = new RbiAlertList(new AlertListRepo(db), new SnapshotsRepo(db));
    expect((await list.match({ names: ['nothing-like-this'], domains: [] })).status).toBe('ok');
  });
});

describe('RDAP (live)', () => {
  it('returns a registration date for a known domain', async () => {
    const r = await new RdapDomains(new CacheRepo(db)).lookup('sebi.gov.in');
    expect(['found', 'not_found', 'unavailable']).toContain(r.status);
    const com = await new RdapDomains(new CacheRepo(db)).lookup('google.com');
    expect(com.status).toBe('found');
    expect(com.registeredOn).toMatch(/^1997-/);
  });
});
