import {
  compareNames,
  officialNameVariants,
  SCHEME_CATEGORY,
  schemeForNormalized,
  type RegistryCategory,
  type RegistryLookup,
  type RegistryNameSearch,
  type RegistryPort,
  type RegistryRecord,
  type SourceAccess,
} from '@jaanch/core';
import type { CacheRepo, RegistryRepo, SnapshotRow, SnapshotsRepo } from '@jaanch/db';
import { SEBI_CATEGORIES } from './categories.js';
import type { SebiClient } from './client.js';
import { SEBI_REGISTRY_SOURCE, SEBI_SOURCE_ID } from './ingest.js';
import { cardToRecord, parseInactive, parseSebiCards } from './parse.js';

export interface SebiRegistryOptions {
  registry: RegistryRepo;
  snapshots: SnapshotsRepo;
  cache: CacheRepo;
  /** Live client for confirming snapshot misses; null disables live lookups. */
  client: SebiClient | null;
  /** A snapshot older than this is flagged stale in reports. */
  staleAfterHours?: number;
  now?: () => Date;
}

const ALL_CATEGORIES = [...new Set(SEBI_CATEGORIES.map((c) => c.category))];
const LIVE_CACHE_MS = 6 * 3_600_000;

/**
 * SEBI register adapter. Answers from the latest snapshot; when a number is missing from the
 * snapshot it confirms against SEBI's live search (the snapshot may be a day old) and, if still
 * missing, checks SEBI's list of cancelled/suspended registrations.
 */
export class SebiRegistry implements RegistryPort {
  private coverageCache: { at: number; rows: SnapshotRow[] } | null = null;

  constructor(private readonly o: SebiRegistryOptions) {}

  private now() {
    return this.o.now?.() ?? new Date();
  }

  private async coverage(): Promise<SnapshotRow[]> {
    if (this.coverageCache && Date.now() - this.coverageCache.at < 60_000)
      return this.coverageCache.rows;
    const rows = await this.o.snapshots.latestSucceeded(SEBI_SOURCE_ID);
    this.coverageCache = { at: Date.now(), rows };
    return rows;
  }

  /**
   * Access facts for a snapshot answer. The "as of" date is the relevant category's own date when
   * known; otherwise the most common date across categories (SEBI's KRA export, for example,
   * carries a 2017 title date and must not make every answer look years old).
   */
  private snapshotAccess(rows: SnapshotRow[], category?: RegistryCategory | null): SourceAccess {
    const own = category ? rows.find((r) => r.scope === category)?.asOf : null;
    const counts = new Map<string, number>();
    for (const r of rows) if (r.asOf) counts.set(r.asOf, (counts.get(r.asOf) ?? 0) + 1);
    const common =
      [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
    const asOf = own ?? common;
    const completed = rows.map((r) => r.completedAt?.getTime() ?? 0).filter(Boolean);
    const oldest = completed.length ? Math.min(...completed) : 0;
    return {
      mode: 'snapshot',
      asOf,
      retrievedAt: oldest ? new Date(oldest).toISOString() : null,
      stale: oldest
        ? this.now().getTime() - oldest > (this.o.staleAfterHours ?? 72) * 3_600_000
        : true,
      isFixture: rows.some((r) => r.isFixture),
    };
  }

  private liveAccess(): SourceAccess {
    const now = this.now().toISOString();
    return {
      mode: 'live',
      asOf: now.slice(0, 10),
      retrievedAt: now,
      stale: false,
      isFixture: false,
    };
  }

  private searchedCategories(rows: SnapshotRow[], live: boolean): RegistryCategory[] {
    return [...new Set(live ? ALL_CATEGORIES : rows.map((r) => r.scope as RegistryCategory))];
  }

  async coveredCategories(): Promise<RegistryCategory[]> {
    const rows = await this.coverage();
    const cats = new Set(rows.map((r) => r.scope as RegistryCategory));
    if (this.o.client) for (const c of ALL_CATEGORIES) cats.add(c);
    return [...cats];
  }

  async lookupByNumber(
    registrationNumber: string,
    options: { allowLive?: boolean } = {},
  ): Promise<RegistryLookup> {
    const regNo = registrationNumber.toUpperCase();
    const rows = await this.coverage();
    const expected = SCHEME_CATEGORY[schemeForNormalized(regNo).scheme] ?? null;
    const snapshot = this.snapshotAccess(rows, expected);
    const records = await this.o.registry.lookupByNumber(SEBI_REGISTRY_SOURCE, regNo);
    if (records.length) {
      return {
        status: 'found',
        records,
        inactive: [],
        access: this.snapshotAccess(rows, records[0]!.category),
        searched: this.searchedCategories(rows, false),
      };
    }

    const allowLive = options.allowLive !== false && this.o.client !== null;
    if (allowLive) {
      try {
        const live = await this.liveLookup(regNo);
        return { ...live, searched: this.searchedCategories(rows, true) };
      } catch (err) {
        if (rows.length === 0) {
          return {
            status: 'unavailable',
            records: [],
            inactive: [],
            access: this.liveAccess(),
            searched: [],
            error: String(err),
          };
        }
        // Live confirmation failed: answer from the snapshot alone (reported as such).
      }
    }
    if (rows.length === 0)
      return {
        status: 'unavailable',
        records: [],
        inactive: [],
        access: snapshot,
        searched: [],
        error: 'no snapshot',
      };
    return {
      status: 'not_found',
      records: [],
      inactive: [],
      access: snapshot,
      searched: this.searchedCategories(rows, false),
    };
  }

  private async liveLookup(regNo: string): Promise<Omit<RegistryLookup, 'searched'>> {
    const key = `sebi:live:num:${regNo}`;
    const cached = await this.o.cache.get<Omit<RegistryLookup, 'searched'>>(key);
    if (cached) return cached;
    const client = this.o.client!;
    const found = parseSebiCards(await client.searchByNumber(regNo))
      .cards.map((c) => cardToRecord(c))
      .filter((r): r is RegistryRecord => r !== null && r.registrationNumber === regNo);
    let result: Omit<RegistryLookup, 'searched'>;
    if (found.length) {
      result = {
        status: 'found',
        records: mergeLive(found),
        inactive: [],
        access: this.liveAccess(),
      };
    } else {
      const inactive = parseInactive(await client.searchInactive(regNo)).filter(
        (r) => r.registrationNumber === regNo,
      );
      result = { status: 'not_found', records: [], inactive, access: this.liveAccess() };
    }
    await this.o.cache.set(key, result, LIVE_CACHE_MS);
    return result;
  }

  async searchByName(name: string, limit = 5): Promise<RegistryNameSearch> {
    const rows = await this.coverage();
    if (rows.length > 0) {
      const candidates = await this.o.registry.searchByName(SEBI_REGISTRY_SOURCE, name, 30);
      const records = rankByName(name, candidates).slice(0, limit);
      return {
        status: records.length ? 'found' : 'not_found',
        records,
        access: this.snapshotAccess(rows),
        searched: this.searchedCategories(rows, false),
      };
    }
    if (!this.o.client)
      return {
        status: 'unavailable',
        records: [],
        access: this.snapshotAccess(rows),
        searched: [],
        error: 'no snapshot',
      };
    try {
      const key = `sebi:live:name:${name.toLowerCase()}`;
      let records = await this.o.cache.get<RegistryRecord[]>(key);
      if (!records) {
        const cards = parseSebiCards(await this.o.client.searchByName(name)).cards;
        records = mergeLive(
          cards.map((c) => cardToRecord(c)).filter((r): r is RegistryRecord => r !== null),
        );
        await this.o.cache.set(key, records, LIVE_CACHE_MS);
      }
      const ranked = rankByName(name, records).slice(0, limit);
      return {
        status: ranked.length ? 'found' : 'not_found',
        records: ranked,
        access: this.liveAccess(),
        searched: this.searchedCategories(rows, true),
      };
    } catch (err) {
      return {
        status: 'unavailable',
        records: [],
        access: this.liveAccess(),
        searched: [],
        error: String(err),
      };
    }
  }
}

function mergeLive(records: RegistryRecord[]): RegistryRecord[] {
  const byKey = new Map<string, RegistryRecord>();
  for (const r of records) {
    const key = `${r.category}:${r.registrationNumber}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...r });
    else {
      prev.names = [...new Set([...prev.names, ...r.names])];
      prev.tradeNames = [...new Set([...prev.tradeNames, ...r.tradeNames])];
      prev.emails = [...new Set([...prev.emails, ...r.emails])];
      prev.phones = [...new Set([...prev.phones, ...r.phones])];
      prev.exchanges = [...new Set([...prev.exchanges, ...r.exchanges])];
    }
  }
  return [...byKey.values()];
}

const RANK = { same: 0, similar: 1, inconclusive: 2, different: 3 } as const;

/** Keep candidates whose names relate to the query, best matches first. */
function rankByName(name: string, records: RegistryRecord[]): RegistryRecord[] {
  return records
    .map((r) => ({ r, c: compareNames(name, officialNameVariants(r)).result }))
    .filter((x) => x.c === 'same' || x.c === 'similar')
    .sort((a, b) => RANK[a.c] - RANK[b.c])
    .map((x) => x.r);
}
