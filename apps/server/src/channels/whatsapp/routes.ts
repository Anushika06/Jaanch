import type { InboundRepo } from '@jaanch/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { safeEqual } from '../../crypto.js';
import type { Logger } from '../../logger.js';
import type { WhatsAppConversation } from './conversation.js';
import { parseMetaWebhook, type MetaTransport } from './meta.js';
import type { MessagingTransport } from './transport.js';
import { parseTwilioInbound, type TwilioTransport } from './twilio.js';

export interface WhatsAppRouteDeps {
  transport: TwilioTransport;
  conversation: WhatsAppConversation;
  inbound: InboundRepo;
  publicBaseUrl: string;
  validateSignature: boolean;
  logger: Logger;
}

/**
 * URLs Twilio may have signed: the configured public URL, plus the URL as seen through the proxy
 * (useful with changing tunnel URLs in development). Accepting either does not weaken the check —
 * the signature still requires the Auth Token.
 */
function candidateUrls(req: FastifyRequest, publicBaseUrl: string): string[] {
  const path = req.url;
  const urls = new Set([`${publicBaseUrl}${path}`]);
  // With trustProxy, protocol and host reflect X-Forwarded-Proto / X-Forwarded-Host.
  if (req.host) urls.add(`${req.protocol}://${req.host}${path}`);
  return [...urls];
}

export async function registerWhatsAppRoutes(
  app: FastifyInstance,
  deps: WhatsAppRouteDeps,
): Promise<void> {
  const verify = (req: FastifyRequest): boolean => {
    if (!deps.validateSignature) return true;
    const signature = req.headers['x-twilio-signature'];
    if (typeof signature !== 'string' || !signature) return false;
    return deps.transport.validateSignature(
      signature,
      candidateUrls(req, deps.publicBaseUrl),
      req.body as Record<string, string>,
    );
  };

  app.post(
    '/webhooks/twilio/whatsapp',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!verify(req)) {
        deps.logger.warn({}, 'rejected webhook with invalid Twilio signature');
        return reply.code(403).send();
      }
      const msg = parseTwilioInbound(req.body as Record<string, string>);
      if (
        msg.providerMessageId &&
        (await deps.inbound.markSeen(msg.providerMessageId, 'whatsapp'))
      ) {
        await deps.conversation.accept(msg);
      }
      // Answer immediately with empty TwiML; replies are sent asynchronously through the API.
      // (Never reply text/plain: Twilio would forward that body to the user.)
      return reply.code(200).type('text/xml').send('<Response/>');
    },
  );

  app.post('/webhooks/twilio/status', async (req, reply) => {
    if (!verify(req)) return reply.code(403).send();
    const p = req.body as Record<string, string>;
    if (p.MessageStatus === 'failed' || p.MessageStatus === 'undelivered') {
      deps.logger.warn(
        { status: p.MessageStatus, errorCode: p.ErrorCode },
        'whatsapp delivery failed',
      );
    }
    return reply.code(204).send();
  });
}

export interface MetaRouteDeps {
  transport: MetaTransport;
  conversation: WhatsAppConversation;
  inbound: InboundRepo;
  phoneNumberId: string;
  verifyToken: string;
  validateSignature: boolean;
  logger: Logger;
}

/**
 * WhatsApp Cloud API webhooks. GET answers Meta's subscription check; POST carries messages and
 * delivery statuses, signed with the App Secret over the exact request bytes — so this route
 * parses JSON itself, after verifying the signature (in its own scope, leaving the rest of the
 * app's JSON parsing unchanged). Meta retries failed deliveries for up to 7 days, which also
 * covers messages sent while a free-tier instance is asleep.
 */
export async function registerMetaWhatsAppRoutes(
  app: FastifyInstance,
  deps: MetaRouteDeps,
): Promise<void> {
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    scope.get('/webhooks/meta/whatsapp', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const token = q['hub.verify_token'] ?? '';
      if (q['hub.mode'] === 'subscribe' && safeEqual(token, deps.verifyToken)) {
        return reply
          .code(200)
          .type('text/plain')
          .send(q['hub.challenge'] ?? '');
      }
      // Lengths only — never the token itself — to tell a typo from a wrong value.
      deps.logger.warn(
        {
          mode: q['hub.mode'] ?? null,
          receivedLength: token.length,
          expectedLength: deps.verifyToken.length,
        },
        'rejected Meta webhook verification (wrong verify token)',
      );
      return reply.code(403).send();
    });

    scope.post(
      '/webhooks/meta/whatsapp',
      { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const signature = req.headers['x-hub-signature-256'];
        if (
          deps.validateSignature &&
          !deps.transport.validateSignature(
            raw,
            typeof signature === 'string' ? signature : undefined,
          )
        ) {
          deps.logger.warn({}, 'rejected webhook with invalid Meta signature');
          return reply.code(403).send();
        }
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString('utf8'));
        } catch {
          return reply.code(400).send();
        }
        const { messages, statuses } = parseMetaWebhook(payload, deps.phoneNumberId);
        for (const msg of messages) {
          if (await deps.inbound.markSeen(msg.providerMessageId, 'whatsapp')) {
            await deps.conversation.accept(msg);
          }
        }
        for (const s of statuses) {
          if (s.status === 'failed')
            deps.logger.warn({ errors: s.errors }, 'whatsapp delivery failed');
        }
        return reply.code(200).send();
      },
    );
  });
}

/**
 * After a restart or a cold start, pull recent inbound messages from the provider (where it can
 * list them — Twilio can) and process any the webhook never delivered. Idempotent: each message
 * id is processed once.
 */
export async function catchUpInbound(
  deps: {
    transport: MessagingTransport;
    conversation: WhatsAppConversation;
    inbound: InboundRepo;
    logger: Logger;
  },
  sinceMs: number,
): Promise<number> {
  if (!deps.transport.listRecentInbound) return 0;
  const since = new Date(Date.now() - sinceMs);
  const messages = await deps.transport.listRecentInbound(since);
  let processed = 0;
  for (const m of messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    if (await deps.inbound.markSeen(m.providerMessageId, 'whatsapp')) {
      await deps.conversation.accept(m);
      processed += 1;
    }
  }
  if (processed) deps.logger.info({ processed }, 'caught up on missed WhatsApp messages');
  return processed;
}
