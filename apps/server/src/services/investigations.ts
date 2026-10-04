import {
  buildReportView,
  InvestigationEngine,
  recoverySteps,
  renderEvidenceSummary,
  t,
  type Channel,
  type InputPart,
  type InvestigationInput,
  type Locale,
  type Report,
  type ReportView,
} from '@jaanch/core';
import type { BlobsRepo, InvestigationsRepo, JobsRepo } from '@jaanch/db';
import { newInvestigationId, newToken, sha256, type Secrets } from '../crypto.js';
import type { Logger } from '../logger.js';
import type { ValidatedMedia } from './media.js';

export const INVESTIGATION_JOB = 'investigation.run';

/** Where to deliver a finished report besides the web (encrypted in the job payload). */
export interface WhatsAppDelivery {
  channel: 'whatsapp';
  replyTo: string;
  sessionKey: string;
  includePrivacyNote: boolean;
}

interface InvestigationJobSecret {
  input: InvestigationInput;
  delivery: WhatsAppDelivery | null;
  redactDigits: string[];
}

export interface CreateInvestigation {
  channel: Channel;
  locale: Locale;
  texts: string[];
  urls: string[];
  media: ValidatedMedia[];
  requesterHash: string | null;
  issueOwnerToken: boolean;
  delivery?: WhatsAppDelivery | null;
  redactDigits?: string[];
  /** Pre-assigned id (WhatsApp assigns one while collecting screenshots). */
  id?: string;
  /** Media already stored as blobs (WhatsApp collection). */
  storedMedia?: Array<{ ref: string; kind: 'image' | 'audio'; mime: string; bytes: number }>;
}

export interface InvestigationStatusView {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string | null;
  createdAt: string;
  expiresAt: string;
  view: ReportView | null;
  error: { code: string } | null;
}

export class InvestigationService {
  constructor(
    private readonly deps: {
      investigations: InvestigationsRepo;
      jobs: JobsRepo;
      blobs: BlobsRepo;
      secrets: Secrets;
      engine: InvestigationEngine;
      logger: Logger;
      reportTtlDays: number;
      mediaTtlMinutes: number;
      webBaseUrl: string;
      poke: () => void;
      onCompleted?: (report: Report, delivery: WhatsAppDelivery) => Promise<void>;
      onFailed?: (id: string, delivery: WhatsAppDelivery, locale: Locale) => Promise<void>;
    },
  ) {}

  reportUrl(id: string): string {
    return `${this.deps.webBaseUrl}/r/${id}`;
  }

  async create(
    req: CreateInvestigation,
  ): Promise<{ id: string; ownerToken: string | null; expiresAt: Date }> {
    const id = req.id ?? newInvestigationId();
    const ownerToken = req.issueOwnerToken ? newToken() : null;
    const expiresAt = new Date(Date.now() + this.deps.reportTtlDays * 86_400_000);
    const parts: InputPart[] = [];
    for (const text of req.texts)
      if (text.trim()) parts.push({ kind: 'text', text: text.slice(0, 20_000) });
    for (const url of req.urls)
      if (url.trim()) parts.push({ kind: 'url', url: url.trim().slice(0, 2_048) });
    for (const m of req.storedMedia ?? []) {
      parts.push(
        m.kind === 'image'
          ? { kind: 'image', blobRef: m.ref, mime: m.mime as 'image/png', bytes: m.bytes }
          : { kind: 'audio', blobRef: m.ref, mime: m.mime as 'audio/ogg', bytes: m.bytes },
      );
    }
    for (const [i, m] of req.media.entries()) {
      const ref = `${id}-${i}-${newToken(6)}`;
      await this.deps.blobs.put(ref, m.bytes, m.mime, this.deps.mediaTtlMinutes * 60_000);
      parts.push(
        m.kind === 'image'
          ? { kind: 'image', blobRef: ref, mime: m.mime, bytes: m.bytes.byteLength }
          : { kind: 'audio', blobRef: ref, mime: m.mime, bytes: m.bytes.byteLength },
      );
    }
    if (parts.length === 0) throw new Error('nothing to investigate');

    const input: InvestigationInput = {
      channel: req.channel,
      locale: req.locale,
      parts: parts.slice(0, 12),
    };
    await this.deps.investigations.create({
      id,
      channel: req.channel,
      locale: req.locale,
      ownerTokenHash: ownerToken ? sha256(ownerToken) : null,
      requesterHash: req.requesterHash,
      // Only the shape of the input is stored — never its content.
      inputSummary: { parts: parts.map((p) => p.kind) },
      expiresAt,
    });
    const secret: InvestigationJobSecret = {
      input,
      delivery: req.delivery ?? null,
      redactDigits: req.redactDigits ?? [],
    };
    await this.deps.jobs.enqueue(
      INVESTIGATION_JOB,
      { investigationId: id, enc: this.deps.secrets.encryptJson(secret) },
      { maxAttempts: 2, dedupeKey: `inv:${id}` },
    );
    this.deps.poke();
    return { id, ownerToken, expiresAt };
  }

  /** Job handler: run the engine and store (and, for WhatsApp, deliver) the report. */
  async run(
    payload: { investigationId: string; enc: string },
    attempt: number,
    maxAttempts: number,
  ): Promise<void> {
    const { investigationId: id } = payload;
    const row = await this.deps.investigations.get(id);
    if (!row) return; // deleted or expired meanwhile
    const secret = this.deps.secrets.decryptJson<InvestigationJobSecret>(payload.enc);
    try {
      const report = await this.deps.engine.run(secret.input, {
        id,
        createdAt: row.createdAt,
        locale: secret.input.locale,
        redactDigits: secret.redactDigits,
        onProgress: (e) => {
          if (e.stage !== 'done')
            void this.deps.investigations.setStage(id, e.stage).catch(() => undefined);
        },
      });
      await this.deps.investigations.complete(id, report);
      if (secret.delivery && this.deps.onCompleted)
        await this.deps.onCompleted(report, secret.delivery);
    } catch (err) {
      this.deps.logger.error(
        { investigation: id, attempt, err: err instanceof Error ? err.message : String(err) },
        'investigation failed',
      );
      if (attempt >= maxAttempts) {
        await this.deps.investigations.fail(id, { code: 'internal_error' });
        if (secret.delivery && this.deps.onFailed)
          await this.deps.onFailed(id, secret.delivery, secret.input.locale);
        return;
      }
      throw err;
    }
  }

  async status(id: string, locale: Locale | null): Promise<InvestigationStatusView | null> {
    const row = await this.deps.investigations.get(id);
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      stage: row.stage,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      view: row.report ? buildReportView(row.report, locale ?? row.locale) : null,
      error: row.error ? { code: row.error.code } : null,
    };
  }

  async report(id: string): Promise<{ report: Report; expiresAt: Date } | null> {
    const row = await this.deps.investigations.get(id);
    return row?.report ? { report: row.report, expiresAt: row.expiresAt } : null;
  }

  async summary(id: string, locale: Locale): Promise<string | null> {
    const r = await this.report(id);
    if (!r) return null;
    return renderEvidenceSummary(r.report, locale, {
      reportUrl: this.reportUrl(id),
      expiresAt: r.expiresAt.toISOString(),
    });
  }

  async recovery(
    id: string,
    locale: Locale,
  ): Promise<{
    title: string;
    steps: Array<{ id: string; text: string; href: string | null; phone: string | null }>;
    summary: string;
  } | null> {
    const r = await this.report(id);
    if (!r) return null;
    const identityMatched = r.report.results.some((x) => x.reason.code === 'ID_CONTACTS_MATCH');
    return {
      title: t(locale, 'UI_RECOVERY'),
      steps: recoverySteps({ identityMatchedOfficialRecord: identityMatched }).map((s) => ({
        id: s.id,
        text: t(locale, s.reason),
        href: s.href,
        phone: s.phone,
      })),
      summary: renderEvidenceSummary(r.report, locale, {
        reportUrl: this.reportUrl(id),
        expiresAt: r.expiresAt.toISOString(),
      }),
    };
  }

  async deleteOwned(id: string, ownerToken: string): Promise<boolean> {
    return this.deps.investigations.deleteOwned(id, sha256(ownerToken));
  }
}
