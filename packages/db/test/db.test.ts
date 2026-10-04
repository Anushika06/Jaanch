import type { RegistryRecord } from '@jaanch/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AlertListRepo,
  BlobsRepo,
  CacheRepo,
  InboundRepo,
  InvestigationsRepo,
  JobsRepo,
  RegistryRepo,
  SessionsRepo,
  SnapshotsRepo,
  migrate,
  openDb,
  sweepExpired,
  type Db,
} from '../src/index.js';

let db: Db;

beforeAll(async () => {
  // Embedded PGlite by default; set JAANCH_TEST_DATABASE_URL to run the same suite on a real,
  // empty Postgres (e.g. `docker compose up -d postgres`).
  db = await openDb({ url: process.env.JAANCH_TEST_DATABASE_URL });
  const ran = await migrate(db);
  expect(ran).toEqual(['0001_init']);
  expect(await migrate(db)).toEqual([]); // idempotent
});
afterAll(async () => {
  await db.close();
});

// FIXTURE: fictional records for repository tests.
const rec = (n: string, names: string[], extra: Partial<RegistryRecord> = {}): RegistryRecord => ({
  registrationNumber: n,
  category: 'RA',
  categoryLabel: 'Research Analyst',
  names,
  tradeNames: [],
  contactPerson: null,
  emails: [],
  phones: [],
  address: null,
  city: null,
  state: null,
  validFrom: '2021-01-01',
  validTo: null,
  exchanges: [],
  sourceUrl: 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14',
  ...extra,
});

describe('job queue', () => {
  it('claims, completes and never hands the same job to two workers', async () => {
    const jobs = new JobsRepo(db);
    const id = await jobs.enqueue('test.a', { n: 1 });
    expect(id).toBeTruthy();
    const [a, b] = await Promise.all([jobs.claim('w1', ['test.a']), jobs.claim('w2', ['test.a'])]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const job = (a ?? b)!;
    expect(job.payload).toEqual({ n: 1 });
    expect(job.attempts).toBe(1);
    await jobs.complete(job.id);
    expect(await jobs.claim('w1', ['test.a'])).toBeNull();
  });

  it('retries failures with backoff, then gives up', async () => {
    const jobs = new JobsRepo(db);
    await jobs.enqueue('test.b', {}, { maxAttempts: 2 });
    const j1 = (await jobs.claim('w', ['test.b']))!;
    expect(await jobs.fail(j1.id, 'boom', 0)).toBe('retry');
    const j2 = (await jobs.claim('w', ['test.b']))!;
    expect(j2.attempts).toBe(2);
    expect(await jobs.fail(j2.id, 'boom again', 0)).toBe('failed');
    expect(await jobs.claim('w', ['test.b'])).toBeNull();
  });

  it('debounces by key and recovers stale leases', async () => {
    const jobs = new JobsRepo(db);
    const later = new Date(Date.now() + 60_000);
    const id1 = await jobs.upsertDebounced('test.c', 'k1', { parts: 1 }, later);
    const id2 = await jobs.upsertDebounced(
      'test.c',
      'k1',
      { parts: 2 },
      new Date(Date.now() - 1000),
    );
    expect(id2).toBe(id1);
    const job = (await jobs.claim('w', ['test.c']))!;
    expect(job.payload).toEqual({ parts: 2 });
    expect(await jobs.recoverStale(0)).toBeGreaterThanOrEqual(1);
    const again = (await jobs.claim('w', ['test.c']))!;
    expect(again.id).toBe(job.id);
    await jobs.complete(again.id);
    // After completion the key is free again.
    expect(await jobs.enqueue('test.c', {}, { dedupeKey: 'k1' })).toBeTruthy();
  });
});

describe('registry snapshot', () => {
  it('replaces a category atomically and searches by name', async () => {
    const snaps = new SnapshotsRepo(db);
    const reg = new RegistryRepo(db);
    const s1 = await snaps.start('sebi_intermediaries', 'RA', null, true);
    await reg.replaceCategory(
      'sebi',
      'RA',
      [
        rec('INH000099991', ['ABC RESEARCH PRIVATE LIMITED']),
        rec('INH000099993', ['RAHUL KUMAR SHARMA (Proprietor: Bull Insights)']),
      ],
      s1,
    );
    await snaps.succeed(s1, { asOf: '2026-10-03', recordCount: 2 });

    expect((await reg.lookupByNumber('sebi', 'INH000099991'))[0]!.names).toEqual([
      'ABC RESEARCH PRIVATE LIMITED',
    ]);
    expect(
      (await reg.searchByName('sebi', 'Bull Insights')).map((r) => r.registrationNumber),
    ).toContain('INH000099993');
    expect(
      (await reg.searchByName('sebi', 'राहुल शर्मा')).map((r) => r.registrationNumber),
    ).toContain('INH000099993');

    const s2 = await snaps.start('sebi_intermediaries', 'RA', null, true);
    const removed = await reg.replaceCategory(
      'sebi',
      'RA',
      [rec('INH000099991', ['ABC RESEARCH PRIVATE LIMITED'], { validTo: '2030-01-01' })],
      s2,
    );
    await snaps.succeed(s2, { asOf: '2026-10-04', recordCount: 1 });
    expect(removed).toBe(1);
    expect(await reg.lookupByNumber('sebi', 'INH000099993')).toEqual([]);
    expect((await reg.lookupByNumber('sebi', 'INH000099991'))[0]!.validTo).toBe('2030-01-01');

    const latest = await snaps.latestSucceeded('sebi_intermediaries');
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({
      scope: 'RA',
      asOf: '2026-10-04',
      recordCount: 1,
      isFixture: true,
    });
  });

  it('stores alert-list entries', async () => {
    const alerts = new AlertListRepo(db);
    await alerts.replaceAll(
      'rbi',
      [
        {
          name: 'Example FX',
          websites: ['examplefx.com'],
          domains: ['examplefx.com'],
          listUrl: 'https://rbi.org.in/x',
        },
      ],
      1,
    );
    expect(await alerts.list('rbi')).toHaveLength(1);
  });
});

describe('ephemeral data', () => {
  it('handles investigations, sessions, blobs, idempotency and expiry', async () => {
    const inv = new InvestigationsRepo(db);
    await inv.create({
      id: 'J1',
      channel: 'web',
      locale: 'en',
      ownerTokenHash: 'h',
      requesterHash: 'r',
      inputSummary: { parts: 1 },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await inv.setStage('J1', 'checking');
    expect((await inv.get('J1'))!.status).toBe('running');
    expect(await inv.deleteOwned('J1', 'wrong')).toBe(false);
    expect(await inv.countRecentByRequester('r', 60_000)).toBe(1);
    expect(await inv.deleteOwned('J1', 'h')).toBe(true);

    const sessions = new SessionsRepo(db);
    await sessions.upsert('k', 'whatsapp', { locale: 'hi' }, 60_000);
    await sessions.upsert('k', 'whatsapp', { lastInvestigationId: 'J2' }, 60_000);
    expect(await sessions.get('k')).toMatchObject({
      locale: 'hi',
      lastInvestigationId: 'J2',
      seenPrivacy: false,
    });

    const blobs = new BlobsRepo(db);
    await blobs.put('b1', new Uint8Array([1, 2, 3]), 'image/png', 60_000);
    expect(Array.from((await blobs.get('b1'))!.bytes)).toEqual([1, 2, 3]);
    await blobs.delete('b1');
    expect(await blobs.get('b1')).toBeNull();

    const inbound = new InboundRepo(db);
    expect(await inbound.markSeen('SM1', 'whatsapp')).toBe(true);
    expect(await inbound.markSeen('SM1', 'whatsapp')).toBe(false);

    const cache = new CacheRepo(db);
    await cache.set('c', { a: 1 }, 60_000);
    expect(await cache.get('c')).toEqual({ a: 1 });

    await inv.create({
      id: 'J3',
      channel: 'web',
      locale: 'en',
      ownerTokenHash: null,
      requesterHash: null,
      inputSummary: {},
      expiresAt: new Date(Date.now() - 1000),
    });
    await blobs.put('b2', new Uint8Array([9]), 'image/png', -1000);
    const swept = await sweepExpired(db);
    expect(swept.investigations).toBeGreaterThanOrEqual(1);
    expect(swept.blobs).toBeGreaterThanOrEqual(1);
  });
});
