import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { sweepExpired } from '@jaanch/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerWebRoutes } from './channels/web/routes.js';
import { MetaTransport } from './channels/whatsapp/meta.js';
import {
  catchUpInbound,
  registerMetaWhatsAppRoutes,
  registerWhatsAppRoutes,
} from './channels/whatsapp/routes.js';
import { TwilioTransport } from './channels/whatsapp/twilio.js';
import { newToken, safeEqual } from './crypto.js';
import type { Runtime } from './runtime.js';
import { runIngestion, type IngestTarget } from './services/ingestion.js';
import { publicMeta, sourcesStatus } from './services/status.js';
import { PIPELINE_VERSION } from '@jaanch/core';

function resolveWebDist(configured: string | undefined): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    configured,
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../web'),
  ].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(path.join(c, 'index.html'))) ?? null;
}

export async function buildApp(rt: Runtime): Promise<FastifyInstance> {
  const { config } = rt;
  // Our pino instance is wider than FastifyBaseLogger; normalise the instance type for plugins.
  const app = Fastify({
    loggerInstance: rt.logger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: () => newToken(8),
  }) as unknown as FastifyInstance;

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => rt.secrets.hmac(`ip:${req.ip}`),
    allowList: (req) => req.url === '/healthz',
  });
  await app.register(formbody);
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
      files: config.MAX_IMAGES + 1,
      fields: 10,
      fieldSize: 25_000,
      parts: config.MAX_IMAGES + 12,
    },
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err: err.message }, 'unhandled error');
    reply.code(status).send({
      error: {
        code:
          status === 429
            ? 'rate_limited'
            : status === 413
              ? 'too_large'
              : status >= 500
                ? 'internal_error'
                : (err.code ?? 'bad_request'),
      },
    });
  });

  // ------------------------------------------------------------------ health
  app.get('/healthz', async () => ({ ok: true, version: PIPELINE_VERSION }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await rt.db.query('select 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  // ------------------------------------------------------------------ channels
  await registerWebRoutes(app, {
    service: rt.service,
    secrets: rt.secrets,
    limits: {
      maxImages: config.MAX_IMAGES,
      maxUploadMb: config.MAX_UPLOAD_MB,
      perHour: config.WEB_INVESTIGATIONS_PER_HOUR,
    },
    meta: () => publicMeta(rt),
    sourcesStatus: () => sourcesStatus(rt),
  });
  if (rt.transport instanceof TwilioTransport && rt.conversation) {
    await registerWhatsAppRoutes(app, {
      transport: rt.transport,
      conversation: rt.conversation,
      inbound: rt.repos.inbound,
      publicBaseUrl: config.PUBLIC_BASE_URL,
      validateSignature: config.TWILIO_VALIDATE_SIGNATURE,
      logger: rt.logger,
    });
  } else if (rt.transport instanceof MetaTransport && rt.conversation) {
    await registerMetaWhatsAppRoutes(app, {
      transport: rt.transport,
      conversation: rt.conversation,
      inbound: rt.repos.inbound,
      phoneNumberId: config.META_WA_PHONE_NUMBER_ID!,
      verifyToken: config.META_WA_VERIFY_TOKEN!,
      validateSignature: config.META_VALIDATE_SIGNATURE,
      logger: rt.logger,
    });
  }

  // ------------------------------------------------------------------ admin (token-protected)
  if (config.ADMIN_TOKEN) {
    const token = config.ADMIN_TOKEN;
    app.register(async (admin) => {
      admin.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? '';
        if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), token))
          return reply.code(401).send({ error: { code: 'unauthorized' } });
      });
      admin.post<{ Body: { sources?: IngestTarget[] } }>('/admin/ingest', async (req, reply) => {
        const targets = (req.body?.sources ?? ['sebi', 'rbi']).filter(
          (s): s is IngestTarget => s === 'sebi' || s === 'rbi',
        );
        void runIngestion(rt, targets).catch((err) =>
          rt.logger.error({ err: String(err) }, 'ingestion failed'),
        );
        return reply.code(202).send({ started: targets });
      });
      admin.post('/admin/sweep', async () => sweepExpired(rt.db));
      admin.post('/admin/whatsapp/catch-up', async (_req, reply) => {
        if (!rt.transport || !rt.conversation)
          return reply.code(409).send({ error: { code: 'whatsapp_disabled' } });
        return {
          processed: await catchUpInbound(
            {
              transport: rt.transport,
              conversation: rt.conversation,
              inbound: rt.repos.inbound,
              logger: rt.logger,
            },
            6 * 3_600_000,
          ),
        };
      });
      admin.get('/admin/status', async () => ({
        jobs: await rt.repos.jobs.counts(),
        snapshots: await rt.repos.snapshots.recent(20),
        worker: { busy: rt.worker.busy },
      }));
    });
  }

  // ------------------------------------------------------------------ web app
  const dist = config.SERVE_WEB ? resolveWebDist(config.WEB_DIST_DIR) : null;
  if (dist) {
    await app.register(fastifyStatic, {
      root: dist,
      wildcard: false,
      index: ['index.html'],
      maxAge: '1h',
      immutable: false,
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const isPage =
      req.method === 'GET' &&
      !req.url.startsWith('/api/') &&
      !req.url.startsWith('/webhooks/') &&
      !req.url.startsWith('/admin/');
    if (dist && isPage) return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    return reply.code(404).send({ error: { code: 'not_found' } });
  });

  return app;
}
