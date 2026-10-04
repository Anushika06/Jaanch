import {
  foldForMatch,
  nameToLatin,
  type RegistryCategory,
  type RegistryRecord,
} from '@jaanch/core';
import type { Db } from '../db.js';

interface Raw {
  registration_no: string;
  category: RegistryCategory;
  category_label: string;
  names: string[];
  trade_names: string[];
  contact_person: string | null;
  emails: string[];
  phones: string[];
  address: string | null;
  city: string | null;
  state: string | null;
  valid_from: string | null;
  valid_to: string | null;
  exchanges: string[];
  source_url: string;
}

const SELECT = `registration_no, category, category_label, names, trade_names, contact_person, emails, phones,
  address, city, state, valid_from::text as valid_from, valid_to::text as valid_to, exchanges, source_url`;

const toRecord = (r: Raw): RegistryRecord => ({
  registrationNumber: r.registration_no,
  category: r.category,
  categoryLabel: r.category_label,
  names: r.names,
  tradeNames: r.trade_names,
  contactPerson: r.contact_person,
  emails: r.emails,
  phones: r.phones,
  address: r.address,
  city: r.city,
  state: r.state,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  exchanges: r.exchanges,
  sourceUrl: r.source_url,
});

/** Text used for trigram name search: every name variant, folded and transliterated. */
export function searchTextFor(
  rec: Pick<RegistryRecord, 'names' | 'tradeNames' | 'contactPerson'>,
): string {
  return foldForMatch(
    nameToLatin(
      [...rec.names, ...rec.tradeNames, rec.contactPerson ?? ''].filter(Boolean).join(' | '),
    ),
  );
}

export class RegistryRepo {
  constructor(private readonly db: Db) {}

  /**
   * Atomically replace one category of one register with a fresh snapshot: upsert every record,
   * then remove records that are no longer published.
   */
  async replaceCategory(
    source: string,
    category: RegistryCategory,
    records: RegistryRecord[],
    snapshotId: number,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const batch = 200;
      for (let i = 0; i < records.length; i += batch) {
        const chunk = records.slice(i, i + batch);
        const values: unknown[] = [];
        const tuples = chunk.map((r, j) => {
          const base = j * 18;
          values.push(
            source,
            r.registrationNumber,
            category,
            r.categoryLabel,
            r.names,
            r.tradeNames,
            r.contactPerson,
            r.emails,
            r.phones,
            r.address,
            r.city,
            r.state,
            r.validFrom,
            r.validTo,
            r.exchanges,
            r.sourceUrl,
            searchTextFor(r),
            snapshotId,
          );
          const p = Array.from({ length: 18 }, (_, k) => `$${base + k + 1}`);
          return `(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}, ${p[4]}::text[], ${p[5]}::text[], ${p[6]}, ${p[7]}::text[], ${p[8]}::text[], ${p[9]}, ${p[10]}, ${p[11]}, ${p[12]}::date, ${p[13]}::date, ${p[14]}::text[], ${p[15]}, ${p[16]}, ${p[17]}::bigint)`;
        });
        await tx.query(
          `insert into registry_entities (source, registration_no, category, category_label, names, trade_names, contact_person,
             emails, phones, address, city, state, valid_from, valid_to, exchanges, source_url, search_text, snapshot_id)
           values ${tuples.join(', ')}
           on conflict (source, registration_no, category) do update set
             category_label = excluded.category_label, names = excluded.names, trade_names = excluded.trade_names,
             contact_person = excluded.contact_person, emails = excluded.emails, phones = excluded.phones,
             address = excluded.address, city = excluded.city, state = excluded.state, valid_from = excluded.valid_from,
             valid_to = excluded.valid_to, exchanges = excluded.exchanges, source_url = excluded.source_url,
             search_text = excluded.search_text, snapshot_id = excluded.snapshot_id, last_seen_at = now()`,
          values,
        );
      }
      const { rowCount } = await tx.query(
        `delete from registry_entities where source = $1 and category = $2 and snapshot_id is distinct from $3::bigint`,
        [source, category, snapshotId],
      );
      return rowCount;
    });
  }

  async lookupByNumber(source: string, registrationNo: string): Promise<RegistryRecord[]> {
    const { rows } = await this.db.query<Raw>(
      `select ${SELECT} from registry_entities where source = $1 and registration_no = $2 order by category`,
      [source, registrationNo],
    );
    return rows.map(toRecord);
  }

  /** Candidate records for a name; callers apply the precise name comparison. */
  async searchByName(source: string, name: string, limit = 20): Promise<RegistryRecord[]> {
    const q = foldForMatch(nameToLatin(name));
    if (q.length < 3) return [];
    const { rows } = await this.db.query<Raw>(
      `select ${SELECT} from registry_entities
       where source = $1 and (search_text like '%' || $2 || '%' or word_similarity($2, search_text) >= 0.6)
       order by word_similarity($2, search_text) desc, registration_no
       limit $3`,
      [source, q, limit],
    );
    return rows.map(toRecord);
  }

  async countByCategory(source: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ category: string; n: number }>(
      `select category, count(*)::int as n from registry_entities where source = $1 group by category`,
      [source],
    );
    return Object.fromEntries(rows.map((r) => [r.category, r.n]));
  }
}

export interface SnapshotRow {
  id: number;
  sourceId: string;
  scope: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  asOf: string | null;
  recordCount: number | null;
  sourceUrl: string | null;
  isFixture: boolean;
  error: string | null;
}

export class SnapshotsRepo {
  constructor(private readonly db: Db) {}

  async start(
    sourceId: string,
    scope: string,
    sourceUrl: string | null,
    isFixture: boolean,
  ): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `insert into source_snapshots (source_id, scope, status, source_url, is_fixture) values ($1, $2, 'running', $3, $4) returning id::int as id`,
      [sourceId, scope, sourceUrl, isFixture],
    );
    return rows[0]!.id;
  }

  async succeed(
    id: number,
    r: { asOf: string | null; recordCount: number; stats?: Record<string, unknown> },
  ): Promise<void> {
    await this.db.query(
      `update source_snapshots set status = 'succeeded', completed_at = now(), as_of = $2::date, record_count = $3, stats = $4::jsonb where id = $1`,
      [id, r.asOf, r.recordCount, JSON.stringify(r.stats ?? {})],
    );
  }

  async fail(id: number, error: string): Promise<void> {
    await this.db.query(
      `update source_snapshots set status = 'failed', completed_at = now(), error = left($2, 2000) where id = $1`,
      [id, error],
    );
  }

  /** Most recent successful snapshot per scope for a source. */
  async latestSucceeded(sourceId: string): Promise<SnapshotRow[]> {
    const { rows } = await this.db.query<{
      id: number;
      source_id: string;
      scope: string;
      status: SnapshotRow['status'];
      started_at: Date;
      completed_at: Date | null;
      as_of: string | null;
      record_count: number | null;
      source_url: string | null;
      is_fixture: boolean;
      error: string | null;
    }>(
      `select distinct on (scope) id::int as id, source_id, scope, status, started_at, completed_at, as_of::text as as_of,
         record_count, source_url, is_fixture, error
       from source_snapshots where source_id = $1 and status = 'succeeded'
       order by scope, completed_at desc`,
      [sourceId],
    );
    return rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      scope: r.scope,
      status: r.status,
      startedAt: new Date(r.started_at),
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      asOf: r.as_of,
      recordCount: r.record_count,
      sourceUrl: r.source_url,
      isFixture: r.is_fixture,
      error: r.error,
    }));
  }

  async recent(limit = 30): Promise<SnapshotRow[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select id::int as id, source_id, scope, status, started_at, completed_at, as_of::text as as_of, record_count, source_url, is_fixture, error
       from source_snapshots order by started_at desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      sourceId: String(r.source_id),
      scope: String(r.scope),
      status: r.status as SnapshotRow['status'],
      startedAt: new Date(r.started_at as string),
      completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
      asOf: (r.as_of as string | null) ?? null,
      recordCount: (r.record_count as number | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
      isFixture: Boolean(r.is_fixture),
      error: (r.error as string | null) ?? null,
    }));
  }
}

export interface AlertEntryRow {
  name: string;
  websites: string[];
  domains: string[];
  listUrl: string;
}

export class AlertListRepo {
  constructor(private readonly db: Db) {}

  async replaceAll(source: string, entries: AlertEntryRow[], snapshotId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(`delete from alert_list_entries where source = $1`, [source]);
      for (const e of entries) {
        await tx.query(
          `insert into alert_list_entries (source, name, name_folded, websites, domains, list_url, snapshot_id)
           values ($1, $2, $3, $4::text[], $5::text[], $6, $7::bigint) on conflict (source, name_folded) do nothing`,
          [source, e.name, foldForMatch(e.name), e.websites, e.domains, e.listUrl, snapshotId],
        );
      }
    });
  }

  async list(source: string): Promise<AlertEntryRow[]> {
    const { rows } = await this.db.query<{
      name: string;
      websites: string[];
      domains: string[];
      list_url: string;
    }>(
      `select name, websites, domains, list_url from alert_list_entries where source = $1 order by name`,
      [source],
    );
    return rows.map((r) => ({
      name: r.name,
      websites: r.websites,
      domains: r.domains,
      listUrl: r.list_url,
    }));
  }
}
