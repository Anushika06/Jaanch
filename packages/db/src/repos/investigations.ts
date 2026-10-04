import type { Channel, Locale, Report } from '@jaanch/core';
import type { Db } from '../db.js';

export type InvestigationStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface InvestigationRow {
  id: string;
  channel: Channel;
  locale: Locale;
  status: InvestigationStatus;
  stage: string | null;
  ownerTokenHash: string | null;
  requesterHash: string | null;
  inputSummary: Record<string, unknown>;
  report: Report | null;
  error: { code: string; message?: string } | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

interface Raw {
  id: string;
  channel: Channel;
  locale: Locale;
  status: InvestigationStatus;
  stage: string | null;
  owner_token_hash: string | null;
  requester_hash: string | null;
  input_summary: Record<string, unknown>;
  report: Report | null;
  error: { code: string; message?: string } | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  expires_at: Date;
}

const toRow = (r: Raw): InvestigationRow => ({
  id: r.id,
  channel: r.channel,
  locale: r.locale,
  status: r.status,
  stage: r.stage,
  ownerTokenHash: r.owner_token_hash,
  requesterHash: r.requester_hash,
  inputSummary: r.input_summary,
  report: r.report,
  error: r.error,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
  completedAt: r.completed_at ? new Date(r.completed_at) : null,
  expiresAt: new Date(r.expires_at),
});

export class InvestigationsRepo {
  constructor(private readonly db: Db) {}

  async create(row: {
    id: string;
    channel: Channel;
    locale: Locale;
    ownerTokenHash: string | null;
    requesterHash: string | null;
    inputSummary: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `insert into investigations (id, channel, locale, status, owner_token_hash, requester_hash, input_summary, expires_at)
       values ($1, $2, $3, 'queued', $4, $5, $6::jsonb, $7)`,
      [
        row.id,
        row.channel,
        row.locale,
        row.ownerTokenHash,
        row.requesterHash,
        JSON.stringify(row.inputSummary),
        row.expiresAt,
      ],
    );
  }

  async get(id: string): Promise<InvestigationRow | null> {
    const { rows } = await this.db.query<Raw>(
      `select * from investigations where id = $1 and expires_at > now()`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async setStage(id: string, stage: string): Promise<void> {
    await this.db.query(
      `update investigations set status = 'running', stage = $2, updated_at = now() where id = $1 and status in ('queued', 'running')`,
      [id, stage],
    );
  }

  async complete(id: string, report: Report): Promise<void> {
    await this.db.query(
      `update investigations set status = 'completed', stage = 'done', report = $2::jsonb, error = null,
         completed_at = now(), updated_at = now() where id = $1`,
      [id, JSON.stringify(report)],
    );
  }

  async fail(id: string, error: { code: string; message?: string }): Promise<void> {
    await this.db.query(
      `update investigations set status = 'failed', error = $2::jsonb, updated_at = now(), completed_at = now() where id = $1`,
      [id, JSON.stringify(error)],
    );
  }

  /** Delete one investigation if the caller proves ownership (hash of the owner token). */
  async deleteOwned(id: string, ownerTokenHash: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `delete from investigations where id = $1 and owner_token_hash = $2`,
      [id, ownerTokenHash],
    );
    return rowCount > 0;
  }

  async deleteByRequester(requesterHash: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `delete from investigations where requester_hash = $1`,
      [requesterHash],
    );
    return rowCount;
  }

  async countRecentByRequester(requesterHash: string, sinceMs: number): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `select count(*)::int as n from investigations where requester_hash = $1 and created_at > now() - ($2::double precision * interval '1 millisecond')`,
      [requesterHash, sinceMs],
    );
    return rows[0]?.n ?? 0;
  }
}
