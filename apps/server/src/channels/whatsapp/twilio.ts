import twilio from 'twilio';
import type { InboundMedia, InboundMessage, MessagingTransport } from './transport.js';
import { PermanentSendError } from './transport.js';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** e.g. "whatsapp:+14155238886" (sandbox) — or use a Messaging Service. */
  from: string | undefined;
  messagingServiceSid: string | undefined;
  statusCallbackUrl: string | undefined;
}

/**
 * Twilio error codes for which retrying cannot succeed:
 * 63015 recipient not in sandbox / session expired, 63016 outside the 24-hour window,
 * 63038 daily message limit, 63112 sender disabled, 21608 unverified number on a trial account,
 * 21617 body too long, 21211 invalid "To".
 */
const PERMANENT_CODES = new Set([63015, 63016, 63038, 63112, 21608, 21617, 21211, 21610]);

/** Same user → same key, whether the id came from a webhook (WaId) or the REST API (From). */
export function userKeyFrom(from: string, waId?: string, externalUserId?: string): string {
  if (externalUserId) return `ext:${externalUserId}`;
  const digits = (waId ?? from).replace(/\D/g, '');
  return digits.length >= 8 ? `tel:${digits}` : `raw:${from}`;
}

export function parseTwilioInbound(p: Record<string, string | undefined>): InboundMessage {
  const n = Math.min(Number(p.NumMedia ?? '0') || 0, 10);
  const media: InboundMedia[] = [];
  for (let i = 0; i < n; i++) {
    const url = p[`MediaUrl${i}`];
    if (!url) continue;
    media.push({
      url,
      contentType: p[`MediaContentType${i}`] ?? 'application/octet-stream',
      providerMediaId: url.split('/').pop() ?? null,
    });
  }
  const from = p.From ?? '';
  return {
    providerMessageId: p.MessageSid ?? p.SmsMessageSid ?? '',
    // WhatsApp usernames: From may become a business-scoped user id; prefer the stable id fields.
    userKey: userKeyFrom(from, p.WaId, p.ExternalUserId),
    replyTo: from,
    text: (p.Body ?? '').slice(0, 20_000),
    media,
    forwarded: p.Forwarded === 'true',
    frequentlyForwarded: p.FrequentlyForwarded === 'true',
    receivedAt: new Date().toISOString(),
  };
}

/** Allowed media hosts: never fetch arbitrary URLs from a webhook body (SSRF). */
function assertTwilioMediaUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'api.twilio.com')
    throw new Error('unexpected media host');
  return u;
}

export class TwilioTransport implements MessagingTransport {
  readonly provider = 'twilio';
  private readonly client: ReturnType<typeof twilio>;

  constructor(private readonly c: TwilioConfig) {
    this.client = twilio(c.accountSid, c.authToken, { autoRetry: true, maxRetries: 2 });
  }

  /** X-Twilio-Signature check (HMAC-SHA1 with the Auth Token over URL + sorted params). */
  validateSignature(signature: string, urls: string[], params: Record<string, string>): boolean {
    return urls.some((url) => twilio.validateRequest(this.c.authToken, signature, url, params));
  }

  async send(to: string, body: string): Promise<{ id: string }> {
    try {
      const msg = await this.client.messages.create({
        to,
        body,
        ...(this.c.messagingServiceSid
          ? { messagingServiceSid: this.c.messagingServiceSid }
          : { from: this.c.from! }),
        ...(this.c.statusCallbackUrl ? { statusCallback: this.c.statusCallbackUrl } : {}),
      });
      return { id: msg.sid };
    } catch (err) {
      const code = (err as { code?: number }).code ?? null;
      if (code !== null && PERMANENT_CODES.has(code))
        throw new PermanentSendError(`twilio ${code}`, code);
      throw err;
    }
  }

  async downloadMedia(
    media: InboundMedia,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; contentType: string }> {
    const url = assertTwilioMediaUrl(media.url);
    const auth = `Basic ${Buffer.from(`${this.c.accountSid}:${this.c.authToken}`).toString('base64')}`;
    // Twilio redirects to a short-lived CDN URL; follow it manually without sending credentials.
    let res = await fetch(url, {
      headers: { Authorization: auth },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('media redirect without location');
      const next = new URL(location, url);
      if (next.protocol !== 'https:') throw new Error('insecure media redirect');
      res = await fetch(next, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    }
    if (!res.ok) throw new Error(`media download failed (${res.status})`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new Error('media too large');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('media too large');
    return { bytes, contentType: res.headers.get('content-type') ?? media.contentType };
  }

  async deleteMedia(messageId: string, media: InboundMedia): Promise<void> {
    if (!media.providerMediaId) return;
    await this.client.messages(messageId).media(media.providerMediaId).remove();
  }

  async listRecentInbound(since: Date): Promise<InboundMessage[]> {
    const to = this.c.from;
    if (!to) return [];
    const messages = await this.client.messages.list({ to, dateSentAfter: since, limit: 100 });
    const out: InboundMessage[] = [];
    for (const m of messages) {
      if (m.direction !== 'inbound') continue;
      const media: InboundMedia[] = [];
      if (Number(m.numMedia) > 0) {
        for (const item of await this.client.messages(m.sid).media.list({ limit: 10 })) {
          media.push({
            url: `https://api.twilio.com${item.uri.replace(/\.json$/, '')}`,
            contentType: item.contentType,
            providerMediaId: item.sid,
          });
        }
      }
      out.push({
        providerMessageId: m.sid,
        userKey: userKeyFrom(m.from),
        replyTo: m.from,
        text: (m.body ?? '').slice(0, 20_000),
        media,
        forwarded: false,
        frequentlyForwarded: false,
        receivedAt: (m.dateSent ?? m.dateCreated).toISOString(),
      });
    }
    return out;
  }
}
