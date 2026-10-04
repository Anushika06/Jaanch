import {
  hasDevanagari,
  renderWhatsApp,
  renderWhatsAppRecovery,
  t,
  type Locale,
  type Report,
} from '@jaanch/core';
import type {
  BlobsRepo,
  InvestigationsRepo,
  JobsRepo,
  PendingParts,
  SessionsRepo,
} from '@jaanch/db';
import { newInvestigationId, newToken, type Secrets } from '../../crypto.js';
import type { Logger } from '../../logger.js';
import { MediaError, validateMedia } from '../../services/media.js';
import type { InvestigationService, WhatsAppDelivery } from '../../services/investigations.js';
import type { InboundMessage, MessagingTransport } from './transport.js';
import { PermanentSendError } from './transport.js';

export const WA_INBOUND_JOB = 'whatsapp.inbound';
export const WA_COLLECT_JOB = 'whatsapp.collect';
export const WA_SEND_JOB = 'whatsapp.send';

const SESSION_TTL_MS = 30 * 86_400_000;
const MAX_PARTS = 8;
const MAX_COLLECT_MS = 20_000;

type Command = 'help' | 'hindi' | 'english' | 'paid' | 'delete' | 'report' | 'join';

const COMMANDS: Array<[Command, RegExp]> = [
  ['join', /^join\s+[a-z]+(-[a-z]+)*$/],
  ['help', /^(hi|hello|hey|help|start|menu|namaste|namaskar|नमस्ते|नमस्कार|मदद|हेल्प)$/],
  ['hindi', /^(hindi|हिंदी|हिन्दी)$/],
  ['english', /^(english|angrezi|इंग्लिश|अंग्रेज़ी|अंग्रेजी)$/],
  [
    'paid',
    /^(paid|i paid|already paid|i already paid|payment done|maine paise bhej diye|paise bhej diye|पेमेंट कर दिया|पैसे भेज दिए|भुगतान कर दिया)$/,
  ],
  ['delete', /^(delete|forget|forget me|delete my data|डिलीट|मिटाओ|मिटा दो)$/],
  ['report', /^(report|link|full report|रिपोर्ट)$/],
];

/** A message is a command only when it is *exactly* a command word — forwarded pitches never are. */
export function detectCommand(text: string): Command | null {
  const norm = text
    .trim()
    .toLowerCase()
    .replace(/[!.?।\s]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!norm || norm.length > 40) return null;
  for (const [cmd, re] of COMMANDS) if (re.test(norm)) return cmd;
  return null;
}

type PendingPart =
  | { kind: 'text'; text: string }
  | { kind: 'media'; ref: string; mediaKind: 'image' | 'audio'; mime: string; bytes: number };

interface PendingSecret {
  parts: PendingPart[];
  replyTo: string;
  redact: string[];
}

export interface ConversationDeps {
  transport: MessagingTransport;
  sessions: SessionsRepo;
  investigations: InvestigationsRepo;
  service: InvestigationService;
  jobs: JobsRepo;
  blobs: BlobsRepo;
  secrets: Secrets;
  logger: Logger;
  poke: () => void;
  config: {
    collectWindowMs: number;
    maxImageBytes: number;
    mediaTtlMinutes: number;
    reportTtlDays: number;
    investigationsPerHour: number;
    deleteInboundMedia: boolean;
    minSendIntervalMs: number;
    webBaseUrl: string;
  };
}

/**
 * WhatsApp conversation logic, independent of the messaging provider. Everything a user sends
 * is either a command (HELP, HINDI, PAID, DELETE…) or content to investigate; content arriving
 * within a few seconds (a forwarded message plus screenshots) is investigated together.
 */
export class WhatsAppConversation {
  private sendChain: Promise<void> = Promise.resolve();
  private lastSendAt = 0;

  constructor(private readonly d: ConversationDeps) {}

  sessionKey(userKey: string): string {
    return this.d.secrets.hmac(`whatsapp:${userKey}`);
  }

  /** Queue an inbound message for processing (called by the webhook after validation). */
  async accept(msg: InboundMessage): Promise<void> {
    await this.d.jobs.enqueue(
      WA_INBOUND_JOB,
      { enc: this.d.secrets.encryptJson(msg) },
      { dedupeKey: `wa-in:${msg.providerMessageId}`, maxAttempts: 3 },
    );
    this.d.poke();
  }

  async handleInbound(payload: { enc: string }): Promise<void> {
    const msg = this.d.secrets.decryptJson<InboundMessage>(payload.enc);
    const key = this.sessionKey(msg.userKey);
    const session = await this.d.sessions.get(key);
    const locale: Locale = session?.locale ?? (hasDevanagari(msg.text) ? 'hi' : 'en');
    const command = msg.media.length === 0 ? detectCommand(msg.text) : null;

    switch (command) {
      case 'join':
        return; // Sandbox opt-in, answered by Twilio itself.
      case 'help':
        // One message, not two: every WhatsApp message is billed (and trial accounts are capped).
        await this.queueSend(msg.replyTo, [
          `${t(locale, 'WA_WELCOME')}\n\n${t(locale, 'WA_HELP')}`,
        ]);
        return;
      case 'hindi':
      case 'english': {
        const next: Locale = command === 'hindi' ? 'hi' : 'en';
        await this.d.sessions.upsert(key, 'whatsapp', { locale: next }, SESSION_TTL_MS);
        await this.queueSend(msg.replyTo, [t(next, 'WA_LANG_SET')]);
        return;
      }
      case 'paid':
        await this.sendRecovery(msg.replyTo, session?.lastInvestigationId ?? null, locale);
        return;
      case 'report': {
        const id = session?.lastInvestigationId;
        await this.queueSend(msg.replyTo, [
          id
            ? `${t(locale, 'UI_FULL_REPORT')}: ${this.d.service.reportUrl(id)}`
            : t(locale, 'WA_NOTHING_TO_CHECK'),
        ]);
        return;
      }
      case 'delete':
        await this.d.investigations.deleteByRequester(key);
        await this.d.sessions.delete(key);
        await this.queueSend(msg.replyTo, [t(locale, 'WA_DELETED')]);
        return;
      default:
        await this.collectContent(msg, key, locale, session?.pending ?? null);
    }
  }

  private async collectContent(
    msg: InboundMessage,
    key: string,
    locale: Locale,
    pending: PendingParts | null,
  ): Promise<void> {
    const parts: PendingPart[] = [];
    const problems: string[] = [];
    if (msg.text.trim()) parts.push({ kind: 'text', text: msg.text });
    for (const media of msg.media) {
      try {
        const downloaded = await this.d.transport.downloadMedia(
          media,
          Math.max(this.d.config.maxImageBytes, 16 * 1024 * 1024),
        );
        const valid = await validateMedia(downloaded.bytes, this.d.config.maxImageBytes);
        const ref = `wa-${newToken(12)}`;
        await this.d.blobs.put(
          ref,
          valid.bytes,
          valid.mime,
          this.d.config.mediaTtlMinutes * 60_000,
        );
        parts.push({
          kind: 'media',
          ref,
          mediaKind: valid.kind,
          mime: valid.mime,
          bytes: valid.bytes.byteLength,
        });
      } catch (err) {
        problems.push(
          err instanceof MediaError && err.code === 'too_large'
            ? 'WA_TOO_LARGE'
            : 'WA_UNSUPPORTED_MEDIA',
        );
        this.d.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'whatsapp media rejected',
        );
      } finally {
        if (this.d.config.deleteInboundMedia && this.d.transport.deleteMedia) {
          await this.d.transport.deleteMedia(msg.providerMessageId, media).catch(() => undefined);
        }
      }
    }
    if (problems.length)
      await this.queueSend(msg.replyTo, [t(locale, problems[0] as 'WA_TOO_LARGE')]);
    if (parts.length === 0) return;

    const redact =
      msg.replyTo.replace(/\D/g, '').length >= 10 ? [msg.replyTo.replace(/\D/g, '')] : [];
    const previous: PendingSecret = pending
      ? this.d.secrets.decryptJson<PendingSecret>(pending.enc)
      : { parts: [], replyTo: msg.replyTo, redact };
    const merged: PendingSecret = {
      parts: [...previous.parts, ...parts].slice(0, MAX_PARTS),
      replyTo: msg.replyTo,
      redact,
    };
    const firstAt = pending?.firstAt ?? new Date().toISOString();
    const next: PendingParts = {
      investigationId: pending?.investigationId ?? newInvestigationId(),
      firstAt,
      count: merged.parts.length,
      enc: this.d.secrets.encryptJson(merged),
    };
    await this.d.sessions.upsert(
      key,
      'whatsapp',
      { pending: next, ...(pending ? {} : { locale }) },
      SESSION_TTL_MS,
    );

    const runAt = new Date(
      Math.min(
        Date.now() + this.d.config.collectWindowMs,
        new Date(firstAt).getTime() + MAX_COLLECT_MS,
      ),
    );
    await this.d.jobs.upsertDebounced(
      WA_COLLECT_JOB,
      `wa-collect:${key}`,
      { sessionKey: key },
      runAt,
    );
    this.d.poke();
    if (!pending) {
      const hasMedia = parts.some((p) => p.kind === 'media');
      await this.queueSend(msg.replyTo, [t(locale, hasMedia ? 'WA_ACK_COLLECTING' : 'WA_ACK')]);
    }
  }

  /** Job: the collection window closed — start the investigation. */
  async collect(payload: { sessionKey: string }): Promise<void> {
    const key = payload.sessionKey;
    const session = await this.d.sessions.get(key);
    const pending = session?.pending;
    if (!session || !pending) return;
    await this.d.sessions.upsert(key, 'whatsapp', { pending: null }, SESSION_TTL_MS);
    const secret = this.d.secrets.decryptJson<PendingSecret>(pending.enc);
    const locale: Locale = session.locale ?? 'en';

    const recent = await this.d.investigations.countRecentByRequester(key, 3_600_000);
    if (recent >= this.d.config.investigationsPerHour) {
      for (const p of secret.parts)
        if (p.kind === 'media') await this.d.blobs.delete(p.ref).catch(() => undefined);
      await this.queueSend(secret.replyTo, [t(locale, 'WA_RATE_LIMITED')]);
      return;
    }

    const delivery: WhatsAppDelivery = {
      channel: 'whatsapp',
      replyTo: secret.replyTo,
      sessionKey: key,
      includePrivacyNote: !session.seenPrivacy,
    };
    const { id } = await this.d.service.create({
      id: pending.investigationId,
      channel: 'whatsapp',
      locale,
      texts: secret.parts
        .filter((p): p is Extract<PendingPart, { kind: 'text' }> => p.kind === 'text')
        .map((p) => p.text),
      urls: [],
      media: [],
      storedMedia: secret.parts
        .filter((p): p is Extract<PendingPart, { kind: 'media' }> => p.kind === 'media')
        .map((p) => ({ ref: p.ref, kind: p.mediaKind, mime: p.mime, bytes: p.bytes })),
      requesterHash: key,
      issueOwnerToken: false,
      delivery,
      redactDigits: secret.redact,
    });
    await this.d.sessions.upsert(
      key,
      'whatsapp',
      { lastInvestigationId: id, seenPrivacy: true },
      SESSION_TTL_MS,
    );
  }

  /** Called when an investigation with WhatsApp delivery completes. */
  async deliverReport(report: Report, delivery: WhatsAppDelivery): Promise<void> {
    const messages = renderWhatsApp(report, report.locale, {
      reportUrl: this.d.service.reportUrl(report.id),
      ttlDays: this.d.config.reportTtlDays,
      includePrivacyNote: delivery.includePrivacyNote,
    });
    await this.queueSend(delivery.replyTo, messages);
  }

  async deliverFailure(delivery: WhatsAppDelivery, locale: Locale): Promise<void> {
    await this.queueSend(delivery.replyTo, [t(locale, 'WA_ERROR')]);
  }

  private async sendRecovery(
    replyTo: string,
    investigationId: string | null,
    locale: Locale,
  ): Promise<void> {
    const row = investigationId ? await this.d.investigations.get(investigationId) : null;
    const messages = renderWhatsAppRecovery(row?.report ?? null, locale, {
      reportUrl: row ? this.d.service.reportUrl(row.id) : null,
      recoveryUrl: row ? `${this.d.config.webBaseUrl}/r/${row.id}/paid` : null,
    });
    await this.queueSend(replyTo, messages);
  }

  /** Messages to one user go out in order, as a single job. */
  async queueSend(to: string, bodies: string[]): Promise<void> {
    await this.d.jobs.enqueue(
      WA_SEND_JOB,
      { enc: this.d.secrets.encryptJson({ to, bodies }) },
      { maxAttempts: 4 },
    );
    this.d.poke();
  }

  /** Job: send queued messages, spaced to respect provider rate limits (sandbox: 1 per 3 s). */
  async send(payload: { enc: string }): Promise<void> {
    const { to, bodies } = this.d.secrets.decryptJson<{ to: string; bodies: string[] }>(
      payload.enc,
    );
    const run = async () => {
      for (const [i, body] of bodies.entries()) {
        const wait = this.lastSendAt + this.d.config.minSendIntervalMs - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastSendAt = Date.now();
        try {
          await this.d.transport.send(to, body);
        } catch (err) {
          if (err instanceof PermanentSendError) {
            this.d.logger.warn(
              { code: err.code },
              'whatsapp send rejected permanently; dropping message',
            );
            return;
          }
          if (i === 0) throw err; // nothing sent yet: let the job retry as a whole
          // Retry only what was not sent, so the user never gets duplicates.
          await this.d.jobs.enqueue(
            WA_SEND_JOB,
            { enc: this.d.secrets.encryptJson({ to, bodies: bodies.slice(i) }) },
            {
              maxAttempts: 4,
              runAt: new Date(Date.now() + 5_000),
            },
          );
          this.d.logger.warn(
            { remaining: bodies.length - i },
            'whatsapp send failed mid-sequence; remainder re-queued',
          );
          return;
        }
      }
    };
    // Serialise all sends from this process so pacing holds across concurrent jobs.
    const next = this.sendChain.then(run, run);
    this.sendChain = next.catch(() => undefined);
    await next;
  }
}
