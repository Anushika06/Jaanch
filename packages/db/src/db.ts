import { mkdirSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/**
 * Minimal database interface used by every repository. Two implementations share one SQL
 * dialect (PostgreSQL):
 * - `postgres`: node-postgres pool, used in production (e.g. Neon) and with docker-compose;
 * - `pglite`: embedded Postgres compiled to WASM, used for zero-setup local development and
 *   tests. Same SQL, same migrations — no separate SQLite code path.
 */
export interface Db {
  readonly kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  /** Run one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  /** postgres:// connection string. When absent, an embedded PGlite database is used. */
  url?: string | undefined;
  /** Directory for the embedded database; omit for in-memory (tests). */
  dataDir?: string | undefined;
  /** Maximum pool size for postgres. */
  maxConnections?: number;
}

class PostgresDb implements Db {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: pg.Pool) {}

  async query<T>(sql: string, params: unknown[] = []) {
    const res = await this.pool.query(sql, params as unknown[]);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  }

  async exec(sql: string) {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Db = {
      kind: 'postgres',
      query: async <R>(sql: string, params: unknown[] = []) => {
        const res = await client.query(sql, params as unknown[]);
        return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
      },
      exec: async (sql: string) => {
        await client.query(sql);
      },
      transaction: (inner) => inner(tx),
      close: async () => undefined,
    };
    try {
      await client.query('BEGIN');
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

type PgliteTx = Parameters<Parameters<PGlite['transaction']>[0]>[0];

class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGlite) {}

  async query<T>(sql: string, params: unknown[] = []) {
    const res = await this.db.query<T>(sql, params as unknown[]);
    return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
  }

  async exec(sql: string) {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (raw: PgliteTx) => {
      const tx: Db = {
        kind: 'pglite',
        query: async <R>(sql: string, params: unknown[] = []) => {
          const res = await raw.query<R>(sql, params as unknown[]);
          return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
        },
        exec: async (sql: string) => {
          await raw.exec(sql);
        },
        transaction: (inner) => inner(tx),
        close: async () => undefined,
      };
      return fn(tx);
    });
  }

  async close() {
    await this.db.close();
  }
}

// Return DATE columns as 'YYYY-MM-DD' strings and int8 as numbers where safe.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

export async function openDb(options: OpenDbOptions = {}): Promise<Db> {
  if (options.url) {
    const pool = new pg.Pool({
      connectionString: options.url,
      max: options.maxConnections ?? 5,
      idleTimeoutMillis: 30_000,
      // Let an idle serverless database (e.g. Neon) scale to zero.
      allowExitOnIdle: true,
    });
    pool.on('error', () => undefined); // idle-client errors are surfaced on next query
    return new PostgresDb(pool);
  }
  // Loaded only when needed: production (Postgres URL) never pays for the WASM database.
  const [{ PGlite }, { pg_trgm }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pg_trgm'),
  ]);
  if (options.dataDir && !options.dataDir.includes('://'))
    mkdirSync(options.dataDir, { recursive: true });
  const db = await PGlite.create(options.dataDir ?? 'memory://', { extensions: { pg_trgm } });
  return new PgliteDb(db);
}
