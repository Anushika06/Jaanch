import type { Db } from '../db.js';

export interface Job<P = unknown> {
  id: string;
  kind: string;
  payload: P;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  dedupeKey: string | null;
}

interface Raw {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  dedupe_key: string | null;
}

const toJob = <P>(r: Raw): Job<P> => ({
  id: String(r.id),
  kind: r.kind,
  payload: r.payload as P,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  runAt: new Date(r.run_at),
  dedupeKey: r.dedupe_key,
});

const COLUMNS = `id::text as id, kind, payload, attempts, max_attempts, run_at, dedupe_key`;

/**
 * Postgres-backed job queue. Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so any number of
 * worker processes can share the table safely; a lease (locked_at) lets crashed jobs be
 * recovered. No Redis or broker is needed.
 */
export class JobsRepo {
  constructor(private readonly db: Db) {}

  async enqueue<P>(
    kind: string,
    payload: P,
    opts: { runAt?: Date; maxAttempts?: number; dedupeKey?: string } = {},
  ): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into jobs (kind, payload, run_at, max_attempts, dedupe_key)
       values ($1, $2::jsonb, coalesce($3, now()), $4, $5)
       on conflict (dedupe_key) do nothing
       returning id::text as id`,
      [
        kind,
        JSON.stringify(payload),
        opts.runAt ?? null,
        opts.maxAttempts ?? 3,
        opts.dedupeKey ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Insert a job, or — if a pending job with the same dedupe key exists — replace its payload
   * and push its run time later (debouncing, e.g. waiting for more screenshots).
   */
  async upsertDebounced<P>(
    kind: string,
    dedupeKey: string,
    payload: P,
    runAt: Date,
    maxAttempts = 3,
  ): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into jobs (kind, payload, run_at, max_attempts, dedupe_key)
       values ($1, $2::jsonb, $3, $4, $5)
       on conflict (dedupe_key) do update
         set payload = excluded.payload, run_at = excluded.run_at, updated_at = now()
         where jobs.status = 'pending'
       returning id::text as id`,
      [kind, JSON.stringify(payload), runAt, maxAttempts, dedupeKey],
    );
    if (rows[0]) return rows[0].id;
    // The keyed job is already running: queue a follow-up without the key.
    const id = await this.enqueue(kind, payload, { runAt, maxAttempts });
    return id!;
  }

  async findPendingByKey<P>(dedupeKey: string): Promise<Job<P> | null> {
    const { rows } = await this.db.query<Raw>(
      `select ${COLUMNS} from jobs where dedupe_key = $1 and status = 'pending'`,
      [dedupeKey],
    );
    return rows[0] ? toJob<P>(rows[0]) : null;
  }

  async claim<P = unknown>(workerId: string, kinds?: string[]): Promise<Job<P> | null> {
    const { rows } = await this.db.query<Raw>(
      `update jobs set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
       where id = (
         select id from jobs
         where status = 'pending' and run_at <= now() and ($2::text[] is null or kind = any($2::text[]))
         order by run_at
         for update skip locked
         limit 1
       )
       returning ${COLUMNS}`,
      [workerId, kinds ?? null],
    );
    return rows[0] ? toJob<P>(rows[0]) : null;
  }

  /** Mark done and scrub the payload: job payloads may hold (encrypted) message content. */
  async complete(id: string): Promise<void> {
    await this.db.query(
      `update jobs set status = 'done', locked_at = null, dedupe_key = null, payload = '{}'::jsonb, updated_at = now()
       where id = $1::bigint`,
      [id],
    );
  }

  /** Record a failure; retry after `retryDelayMs` unless attempts are exhausted. */
  async fail(id: string, error: string, retryDelayMs: number | null): Promise<'retry' | 'failed'> {
    const { rows } = await this.db.query<{ status: string }>(
      `update jobs set
         status = case when $3::double precision is not null and attempts < max_attempts then 'pending' else 'failed' end,
         run_at = case when $3::double precision is not null then now() + ($3::double precision * interval '1 millisecond') else run_at end,
         dedupe_key = case when $3::double precision is not null and attempts < max_attempts then dedupe_key else null end,
         payload = case when $3::double precision is not null and attempts < max_attempts then payload else '{}'::jsonb end,
         last_error = left($2, 2000), locked_at = null, updated_at = now()
       where id = $1::bigint
       returning status`,
      [id, error, retryDelayMs],
    );
    return rows[0]?.status === 'pending' ? 'retry' : 'failed';
  }

  /** Return jobs whose worker died mid-run (lease expired) to the queue. */
  async recoverStale(leaseMs: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `update jobs set status = 'pending', locked_at = null, locked_by = null, updated_at = now()
       where status = 'running' and locked_at <= now() - ($1::double precision * interval '1 millisecond')`,
      [leaseMs],
    );
    return rowCount;
  }

  async nextRunAt(): Promise<Date | null> {
    const { rows } = await this.db.query<{ run_at: Date | null }>(
      `select min(run_at) as run_at from jobs where status = 'pending'`,
    );
    return rows[0]?.run_at ? new Date(rows[0].run_at) : null;
  }

  async counts(): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from jobs group by status`,
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}
