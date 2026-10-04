import type { Db } from './db.js';

/**
 * Forward-only SQL migrations. Each runs once, in order, inside a transaction, and is recorded
 * in schema_migrations. Never edit a released migration — add a new one.
 */
export const MIGRATIONS: Array<{ version: string; sql: string }> = [
  {
    version: '0001_init',
    sql: /* sql */ `
create extension if not exists pg_trgm;

-- One row per investigation. Reports expire (privacy): see expires_at and the sweeper.
create table investigations (
  id              text primary key,
  channel         text not null check (channel in ('web', 'whatsapp', 'api')),
  locale          text not null check (locale in ('en', 'hi')),
  status          text not null check (status in ('queued', 'running', 'completed', 'failed')),
  stage           text,
  owner_token_hash text,
  requester_hash  text,
  input_summary   jsonb not null default '{}'::jsonb,
  report          jsonb,
  error           jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  expires_at      timestamptz not null
);
create index investigations_expires_idx on investigations (expires_at);
create index investigations_requester_idx on investigations (requester_hash, created_at desc);

-- Durable job queue (claimed with FOR UPDATE SKIP LOCKED; safe with several workers).
create table jobs (
  id            bigserial primary key,
  kind          text not null,
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  run_at        timestamptz not null default now(),
  attempts      int not null default 0,
  max_attempts  int not null default 3,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  dedupe_key    text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index jobs_ready_idx on jobs (run_at) where status = 'pending';
create index jobs_running_idx on jobs (locked_at) where status = 'running';

-- Uploaded media, kept only until read (minutes), then deleted.
create table blobs (
  id          text primary key,
  mime        text not null,
  bytes       bytea not null,
  size        int not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index blobs_expires_idx on blobs (expires_at);

-- Per-user channel state, keyed by an HMAC of the channel user id (no raw phone numbers).
create table channel_sessions (
  key                   text primary key,
  channel               text not null,
  locale                text,
  last_investigation_id text,
  pending               jsonb,
  seen_privacy          boolean not null default false,
  updated_at            timestamptz not null default now(),
  expires_at            timestamptz not null
);
create index channel_sessions_expires_idx on channel_sessions (expires_at);

-- Webhook idempotency: provider message ids already processed.
create table inbound_messages (
  id          text primary key,
  channel     text not null,
  received_at timestamptz not null default now()
);
create index inbound_messages_received_idx on inbound_messages (received_at);

-- Snapshots of official registers, one row per register category.
create table registry_entities (
  source           text not null,
  registration_no  text not null,
  category         text not null,
  category_label   text not null,
  names            text[] not null,
  trade_names      text[] not null default '{}',
  contact_person   text,
  emails           text[] not null default '{}',
  phones           text[] not null default '{}',
  address          text,
  city             text,
  state            text,
  valid_from       date,
  valid_to         date,
  exchanges        text[] not null default '{}',
  source_url       text not null,
  search_text      text not null,
  snapshot_id      bigint,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  primary key (source, registration_no, category)
);
create index registry_regno_idx on registry_entities (registration_no);
create index registry_search_trgm_idx on registry_entities using gin (search_text gin_trgm_ops);

-- Provenance of every ingestion run (what, when, as-of date, how many records).
create table source_snapshots (
  id            bigserial primary key,
  source_id     text not null,
  scope         text not null,
  status        text not null check (status in ('running', 'succeeded', 'failed')),
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  as_of         date,
  record_count  int,
  source_url    text,
  is_fixture    boolean not null default false,
  error         text,
  stats         jsonb not null default '{}'::jsonb
);
create index source_snapshots_lookup_idx on source_snapshots (source_id, scope, status, completed_at desc);

-- Official caution/alert lists (e.g. RBI Alert List).
create table alert_list_entries (
  source       text not null,
  name         text not null,
  name_folded  text not null,
  websites     text[] not null default '{}',
  domains      text[] not null default '{}',
  list_url     text not null,
  snapshot_id  bigint,
  primary key (source, name_folded)
);

-- Small TTL cache for live lookups (e.g. RDAP).
create table cache_entries (
  key         text primary key,
  value       jsonb not null,
  expires_at  timestamptz not null
);
`,
  },
];

export async function migrate(db: Db): Promise<string[]> {
  await db.query(
    `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`,
  );
  const { rows } = await db.query<{ version: string }>('select version from schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('insert into schema_migrations (version) values ($1)', [m.version]);
    });
    ran.push(m.version);
  }
  return ran;
}
