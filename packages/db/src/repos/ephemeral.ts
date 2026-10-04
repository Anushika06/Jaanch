import type { Locale } from '@jaanch/core';
import type { Db } from '../db.js';

/** Uploaded media, held only until the investigation has read it. */
export class BlobsRepo {
  constructor(private readonly db: Db) {}

  async put(id: string, bytes: Uint8Array, mime: string, ttlMs: number): Promise<void> {
    await this.db.query(
      `insert into blobs (id, mime, bytes, size, expires_at) values ($1, $2, $3, $4, now() + ($5::double precision * interval '1 millisecond'))`,
      [id, mime, Buffer.from(bytes), bytes.byteLength, ttlMs],
    );
  }

  async get(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const { rows } = await this.db.query<{ bytes: Uint8Array; mime: string }>(
      `select bytes, mime from blobs where id = $1 and expires_at > now()`,
      [id],
    );
    const r = rows[0];
    return r ? { bytes: new Uint8Array(r.bytes), mime: r.mime } : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`delete from blobs where id = $1`, [id]);
  }
}

export interface SessionRow {
  key: string;
  channel: string;
  locale: Locale | null;
  lastInvestigationId: string | null;
  pending: PendingParts | null;
  seenPrivacy: boolean;
}

/**
 * Parts received but not yet investigated (multi-screenshot aggregation). The parts themselves
 * are encrypted by the application (`enc`); the database only stores ciphertext.
 */
export interface PendingParts {
  investigationId: string;
  firstAt: string;
  count: number;
  enc: string;
}

/** Per-user channel state, keyed by an HMAC — never a raw phone number. */
export class SessionsRepo {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<SessionRow | null> {
    const { rows } = await this.db.query<{
      key: string;
      channel: string;
      locale: Locale | null;
      last_investigation_id: string | null;
      pending: PendingParts | null;
      seen_privacy: boolean;
    }>(`select * from channel_sessions where key = $1 and expires_at > now()`, [key]);
    const r = rows[0];
    return r
      ? {
          key: r.key,
          channel: r.channel,
          locale: r.locale,
          lastInvestigationId: r.last_investigation_id,
          pending: r.pending,
          seenPrivacy: r.seen_privacy,
        }
      : null;
  }

  async upsert(
    key: string,
    channel: string,
    patch: Partial<Pick<SessionRow, 'locale' | 'lastInvestigationId' | 'pending' | 'seenPrivacy'>>,
    ttlMs: number,
  ): Promise<void> {
    await this.db.query(
      `insert into channel_sessions (key, channel, locale, last_investigation_id, pending, seen_privacy, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, coalesce($6, false), now() + ($7::double precision * interval '1 millisecond'))
       on conflict (key) do update set
         locale = case when $8 then excluded.locale else channel_sessions.locale end,
         last_investigation_id = case when $9 then excluded.last_investigation_id else channel_sessions.last_investigation_id end,
         pending = case when $10 then excluded.pending else channel_sessions.pending end,
         seen_privacy = case when $11 then excluded.seen_privacy else channel_sessions.seen_privacy end,
         updated_at = now(),
         expires_at = excluded.expires_at`,
      [
        key,
        channel,
        patch.locale ?? null,
        patch.lastInvestigationId ?? null,
        patch.pending === undefined ? null : JSON.stringify(patch.pending),
        patch.seenPrivacy ?? null,
        ttlMs,
        'locale' in patch,
        'lastInvestigationId' in patch,
        'pending' in patch,
        'seenPrivacy' in patch,
      ],
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.query(`delete from channel_sessions where key = $1`, [key]);
  }
}

/** Webhook idempotency. Returns true the first time an id is seen. */
export class InboundRepo {
  constructor(private readonly db: Db) {}

  async markSeen(id: string, channel: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `insert into inbound_messages (id, channel) values ($1, $2) on conflict (id) do nothing`,
      [id, channel],
    );
    return rowCount > 0;
  }

  async latestReceivedAt(channel: string): Promise<Date | null> {
    const { rows } = await this.db.query<{ t: Date | null }>(
      `select max(received_at) as t from inbound_messages where channel = $1`,
      [channel],
    );
    return rows[0]?.t ? new Date(rows[0].t) : null;
  }
}

/** Small TTL cache for live lookups. */
export class CacheRepo {
  constructor(private readonly db: Db) {}

  async get<T>(key: string): Promise<T | null> {
    const { rows } = await this.db.query<{ value: T }>(
      `select value from cache_entries where key = $1 and expires_at > now()`,
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.db.query(
      `insert into cache_entries (key, value, expires_at) values ($1, $2::jsonb, now() + ($3::double precision * interval '1 millisecond'))
       on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`,
      [key, JSON.stringify(value), ttlMs],
    );
  }
}

/** Delete everything past its retention. Safe to run at any time, from any process. */
export async function sweepExpired(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const run = async (name: string, sql: string) => {
    out[name] = (await db.query(sql)).rowCount;
  };
  await run('investigations', `delete from investigations where expires_at <= now()`);
  await run('blobs', `delete from blobs where expires_at <= now()`);
  await run('sessions', `delete from channel_sessions where expires_at <= now()`);
  await run(
    'inbound',
    `delete from inbound_messages where received_at < now() - interval '14 days'`,
  );
  await run(
    'jobs',
    `delete from jobs where status in ('done', 'failed') and updated_at < now() - interval '7 days'`,
  );
  await run('cache', `delete from cache_entries where expires_at <= now()`);
  return out;
}
