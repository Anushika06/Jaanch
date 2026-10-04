import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AlertListRepo,
  CacheRepo,
  migrate,
  openDb,
  RegistryRepo,
  SnapshotsRepo,
  type Db,
} from '@jaanch/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFixtures, RbiAlertList, SebiRegistry, type SebiClient } from '../src/index.js';

const fx = (p: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url)), 'utf8');

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

function stubClient(behaviour: 'ok' | 'down'): SebiClient & { calls: string[] } {
  const calls: string[] = [];
  const fail = async () => {
    throw new Error('SEBI unreachable');
  };
  return {
    calls,
    searchByNumber:
      behaviour === 'down'
        ? fail
        : async (n: string) => (
            calls.push(`num:${n}`),
            n === 'INH000011431' ? fx('sebi/search-found.html') : fx('sebi/search-none.html')
          ),
    searchInactive:
      behaviour === 'down'
        ? fail
        : async (n: string) => (
            calls.push(`inactive:${n}`),
            n === 'INH000003358' ? fx('sebi/inactive-found.html') : fx('sebi/search-none.html')
          ),
    searchByName: behaviour === 'down' ? fail : async () => fx('sebi/search-broker.html'),
    fetchExport: fail,
  } as unknown as SebiClient & { calls: string[] };
}

function registry(client: SebiClient | null) {
  return new SebiRegistry({
    registry: new RegistryRepo(db),
    snapshots: new SnapshotsRepo(db),
    cache: new CacheRepo(db),
    client,
  });
}

async function withFixtures() {
  await loadFixtures({
    registry: new RegistryRepo(db),
    snapshots: new SnapshotsRepo(db),
    alerts: new AlertListRepo(db),
  });
}

describe('SEBI registry adapter', () => {
  it('answers from the snapshot and marks fixture data', async () => {
    await withFixtures();
    const r = await registry(null).lookupByNumber('INH000099991');
    expect(r.status).toBe('found');
    expect(r.records[0]!.names).toEqual(['ABC RESEARCH PRIVATE LIMITED']);
    expect(r.access).toMatchObject({ mode: 'snapshot', isFixture: true });
  });

  it('confirms a snapshot miss against the live register', async () => {
    await withFixtures();
    const client = stubClient('ok');
    const r = await registry(client).lookupByNumber('INH000011431');
    expect(r.status).toBe('found');
    expect(r.access.mode).toBe('live');
    expect(r.records[0]!.registrationNumber).toBe('INH000011431');
    // Cached: a second lookup makes no new request.
    await registry(client).lookupByNumber('INH000011431');
    expect(client.calls.filter((c) => c === 'num:INH000011431')).toHaveLength(1);
  });

  it('reports cancelled registrations from SEBI’s inactive list', async () => {
    await withFixtures();
    const r = await registry(stubClient('ok')).lookupByNumber('INH000003358');
    expect(r.status).toBe('not_found');
    expect(r.inactive[0]).toMatchObject({ status: 'Cancelled' });
  });

  it('falls back to the snapshot when SEBI is unreachable, and is honest when nothing is available', async () => {
    await withFixtures();
    expect((await registry(stubClient('down')).lookupByNumber('INH000012345')).status).toBe(
      'not_found',
    );
    const empty = await openDb();
    await migrate(empty);
    const bare = new SebiRegistry({
      registry: new RegistryRepo(empty),
      snapshots: new SnapshotsRepo(empty),
      cache: new CacheRepo(empty),
      client: stubClient('down'),
    });
    expect((await bare.lookupByNumber('INH000012345')).status).toBe('unavailable');
    await empty.close();
  });

  it('never queries SEBI live for speculative lookups', async () => {
    await withFixtures();
    const client = stubClient('ok');
    await registry(client).lookupByNumber('INH000011431', { allowLive: false });
    expect(client.calls).toEqual([]);
  });

  it('searches names including proprietor brands', async () => {
    await withFixtures();
    const r = await registry(null).searchByName('Bull Insights');
    expect(r.records.map((x) => x.registrationNumber)).toContain('INH000099993');
    const none = await registry(null).searchByName('Wealth Mantra Advisory');
    expect(none.status).toBe('not_found');
  });
});

describe('RBI alert list adapter', () => {
  it('matches exact names and domains only', async () => {
    await withFixtures();
    const list = new RbiAlertList(new AlertListRepo(db), new SnapshotsRepo(db));
    const hit = await list.match({
      names: ['Example FX Pro (FIXTURE)'],
      domains: ['examplefxpro.com'],
    });
    expect(hit.matches.map((m) => m.matchedOn).sort()).toEqual(['domain', 'name']);
    const miss = await list.match({ names: ['FX'], domains: ['example.com'] });
    expect(miss.matches).toEqual([]);
  });

  it('is unavailable before the first snapshot', async () => {
    const list = new RbiAlertList(new AlertListRepo(db), new SnapshotsRepo(db));
    expect((await list.match({ names: ['x'], domains: [] })).status).toBe('unavailable');
  });
});
