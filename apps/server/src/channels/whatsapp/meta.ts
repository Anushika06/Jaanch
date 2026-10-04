import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundMedia, InboundMessage, MessagingTransport } from './transport.js';
import { PermanentSendError } from './transport.js';
import { userKeyFrom } from './twilio.js';

/**
 * WhatsApp Cloud API (Meta) transport: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Inbound messages arrive as signed webhooks (X-Hub-Signature-256); replies, media downloads and
 * the sender's display number go through the Graph API with the access token.
 */
export interface MetaConfig {
  accessToken: string;
  /** The WhatsApp phone number id (not the phone number itself). */
  phoneNumberId: string;
  appSecret: string | undefined;
  /** e.g. "v23.0" */
  graphVersion: string;
  /** Shown on the web page; looked up from the Graph API when not configured. */
  displayNumber: string | undefined;
}

/**
 * Graph API error codes that retrying cannot fix
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes):
 * 0/190 token invalid or expired, 3/10/131005 permissions, 100/131008 bad request,
 * 131026 undeliverable, 131031 account restricted, 131047 more than 24 hours since the user
 * last wrote, 131051 unsupported type, 131052/131053 media errors, 132000 template mismatch,
 * 133010 number not registered — and 131030, the test number's "recipient not in allowed list".
 * Rate limits (4, 130429, 131048, 131056) and 131000 are retried.
 */
const PERMANENT_CODES = new Set([
  0, 3, 10, 100, 190, 131005, 131008, 131026, 131030, 131031, 131047, 131051, 131052, 131053,
  132000, 133010,
]);
const TOKEN_CODES = new Set([0, 190]);

/** Media URLs returned by the Graph API live on Meta's CDN; never fetch anything else (SSRF). */
function assertMetaMediaUrl(url: string): URL {
  const u = new URL(url);
  const host = u.hostname;
  if (
    u.protocol !== 'https:' ||
    !(host === 'lookaside.fbsbx.com' || host.endsWith('.fbsbx.com') || host.endsWith('.fbcdn.net'))
  )
    throw new Error('unexpected media host');
  return u;
}

interface MetaWebhookMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  context?: { forwarded?: boolean; frequently_forwarded?: boolean };
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

export interface MetaStatus {
  id: string;
  status: string;
  errors: Array<{ code: number | null; title: string | null }>;
}

/**
 * Parse a webhook payload into inbound messages and delivery statuses. Events for other phone
 * numbers (one app can serve several) are ignored.
 */
export function parseMetaWebhook(
  payload: unknown,
  phoneNumberId: string,
): { messages: InboundMessage[]; statuses: MetaStatus[] } {
  const messages: InboundMessage[] = [];
  const statuses: MetaStatus[] = [];
  const body = payload as {
    object?: string;
    entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>;
  };
  if (body?.object !== 'whatsapp_business_account') return { messages, statuses };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue;
      const value = change.value as {
        metadata?: { phone_number_id?: string };
        messages?: MetaWebhookMessage[];
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{ code?: number; title?: string }>;
        }>;
      };
      if (value.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;
        const media: InboundMedia[] = [];
        let text = '';
        switch (m.type) {
          case 'text':
            text = m.text?.body ?? '';
            break;
          case 'image':
            if (m.image?.id)
              media.push({
                url: '',
                contentType: m.image.mime_type ?? 'image/jpeg',
                providerMediaId: m.image.id,
              });
            text = m.image?.caption ?? '';
            break;
          case 'document':
            // Screenshots are sometimes sent as files; anything else is rejected after download.
            if (m.document?.id)
              media.push({
                url: '',
                contentType: m.document.mime_type ?? 'application/octet-stream',
                providerMediaId: m.document.id,
              });
            text = m.document?.caption ?? '';
            break;
          case 'audio':
            if (m.audio?.id)
              media.push({
                url: '',
                contentType: m.audio.mime_type ?? 'audio/ogg',
                providerMediaId: m.audio.id,
              });
            break;
          case 'button':
            text = m.button?.text ?? '';
            break;
          case 'interactive':
            text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
            break;
          default:
            // Stickers, reactions, locations, videos…: nothing Jaanch can check.
            break;
        }
        if (!text.trim() && media.length === 0 && m.type !== 'text') continue;
        messages.push({
          providerMessageId: m.id,
          userKey: userKeyFrom(m.from),
          replyTo: m.from,
          text: text.slice(0, 20_000),
          media,
          forwarded: m.context?.forwarded === true,
          frequentlyForwarded: m.context?.frequently_forwarded === true,
          receivedAt: m.timestamp
            ? new Date(Number(m.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
      for (const s of value.statuses ?? []) {
        if (!s.id || !s.status) continue;
        statuses.push({
          id: s.id,
          status: s.status,
          errors: (s.errors ?? []).map((e) => ({ code: e.code ?? null, title: e.title ?? null })),
        });
      }
    }
  }
  return { messages, statuses };
}

export class MetaTransport implements MessagingTransport {
  readonly provider = 'meta';
  private displayNumberCache: Promise<string | null> | null = null;

  constructor(private readonly c: MetaConfig) {}

  private graph(path: string): string {
    return `https://graph.facebook.com/${this.c.graphVersion}/${path}`;
  }

  /**
   * X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the raw request body, keyed with the App
   * Secret. Must be computed over the exact bytes received, before any JSON parsing.
   */
  validateSignature(rawBody: Buffer, header: string | undefined): boolean {
    if (!this.c.appSecret || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', this.c.appSecret).update(rawBody).digest();
    const given = Buffer.from(header.slice('sha256='.length), 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async send(to: string, body: string): Promise<{ id: string }> {
    const res = await fetch(this.graph(`${this.c.phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.c.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; message?: string };
    };
    if (res.ok && data.messages?.[0]?.id) return { id: data.messages[0].id };
    const code = data.error?.code ?? null;
    const message = `meta ${code ?? res.status}: ${(data.error?.message ?? '').slice(0, 200)}`;
    if (code !== null && TOKEN_CODES.has(code))
      throw new PermanentSendError(`${message} (check META_WA_ACCESS_TOKEN)`, code);
    if (code !== null && PERMANENT_CODES.has(code)) throw new PermanentSendError(message, code);
    throw new Error(message);
  }

  async downloadMedia(
    media: InboundMedia,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; contentType: string }> {
    if (!media.providerMediaId || !/^\d+$/.test(media.providerMediaId))
      throw new Error('missing media id');
    const auth = { Authorization: `Bearer ${this.c.accessToken}` };
    // 1. Resolve the media id to a short-lived download URL.
    const meta = await fetch(this.graph(media.providerMediaId), {
      headers: auth,
      signal: AbortSignal.timeout(15_000),
    });
    if (!meta.ok) throw new Error(`media lookup failed (${meta.status})`);
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url) throw new Error('media lookup returned no url');
    if ((info.file_size ?? 0) > maxBytes) throw new Error('media too large');
    // 2. Download it (the CDN also requires the token). Redirects are not followed blindly.
    const url = assertMetaMediaUrl(info.url);
    let res = await fetch(url, {
      headers: auth,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('media redirect without location');
      const next = assertMetaMediaUrl(new URL(location, url).toString());
      res = await fetch(next, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    }
    if (!res.ok) throw new Error(`media download failed (${res.status})`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new Error('media too large');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('media too large');
    return {
      bytes,
      contentType: info.mime_type ?? res.headers.get('content-type') ?? media.contentType,
    };
  }

  /** The business phone number people message, e.g. "+1 555-010-0000". Cached; null on failure. */
  displayNumber(): Promise<string | null> {
    if (this.c.displayNumber) return Promise.resolve(this.c.displayNumber);
    this.displayNumberCache ??= fetch(
      this.graph(`${this.c.phoneNumberId}?fields=display_phone_number`),
      {
        headers: { Authorization: `Bearer ${this.c.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
      .then(async (r) =>
        r.ok
          ? (((await r.json()) as { display_phone_number?: string }).display_phone_number ?? null)
          : null,
      )
      .catch(() => null)
      .then((n) => {
        if (n === null) this.displayNumberCache = null; // retry on the next request
        return n;
      });
    return this.displayNumberCache;
  }
}
