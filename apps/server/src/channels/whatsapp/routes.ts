import type { InboundRepo } from '@jaanch/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Logger } from '../../logger.js';
import type { WhatsAppConversation } from './conversation.js';
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

/**
 * After a restart or a cold start, pull recent inbound messages from Twilio and process any the
 * webhook never delivered. Idempotent: each message id is processed once.
 */
export async function catchUpInbound(
  deps: {
    transport: TwilioTransport;
    conversation: WhatsAppConversation;
    inbound: InboundRepo;
    logger: Logger;
  },
  sinceMs: number,
): Promise<number> {
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
