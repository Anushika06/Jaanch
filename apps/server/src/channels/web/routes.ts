import type { Locale } from '@jaanch/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Secrets } from '../../crypto.js';
import type { InvestigationService } from '../../services/investigations.js';
import { MediaError, validateMedia, type ValidatedMedia } from '../../services/media.js';

const ID = /^J[A-Za-z0-9_-]{22}$/;
const LocaleParam = z.enum(['en', 'hi']).optional();

const JsonBody = z.object({
  text: z.string().max(20_000).optional(),
  url: z.string().max(2_048).optional(),
  locale: z.enum(['en', 'hi']).default('en'),
});

export interface WebRouteDeps {
  service: InvestigationService;
  secrets: Secrets;
  limits: { maxImages: number; maxUploadMb: number; perHour: number };
  meta: () => Promise<Record<string, unknown>>;
  sourcesStatus: () => Promise<Record<string, unknown>>;
}

function badRequest(reply: FastifyReply, code: string, message: string) {
  return reply.code(400).send({ error: { code, message } });
}

async function readInput(
  req: FastifyRequest,
  deps: WebRouteDeps,
): Promise<
  | { texts: string[]; urls: string[]; media: ValidatedMedia[]; locale: Locale }
  | { error: string; message: string }
> {
  const maxBytes = deps.limits.maxUploadMb * 1024 * 1024;
  if (!req.isMultipart()) {
    const parsed = JsonBody.safeParse(req.body ?? {});
    if (!parsed.success)
      return { error: 'invalid_body', message: 'Expected JSON with text, url or locale.' };
    const text = parsed.data.text?.trim() ? [parsed.data.text] : [];
    const url = parsed.data.url?.trim() ? [parsed.data.url.trim()] : [];
    return { texts: text, urls: url, media: [], locale: parsed.data.locale };
  }
  const texts: string[] = [];
  const urls: string[] = [];
  const media: ValidatedMedia[] = [];
  let locale: Locale = 'en';
  let images = 0;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const bytes = new Uint8Array(await part.toBuffer());
      if (part.file.truncated)
        return {
          error: 'too_large',
          message: `Each file must be under ${deps.limits.maxUploadMb} MB.`,
        };
      try {
        const m = await validateMedia(bytes, maxBytes);
        if (m.kind === 'image' && ++images > deps.limits.maxImages)
          return {
            error: 'too_many_files',
            message: `Up to ${deps.limits.maxImages} screenshots.`,
          };
        media.push(m);
      } catch (err) {
        const code = err instanceof MediaError ? err.code : 'unsupported_type';
        return {
          error: code,
          message: 'Only JPG/PNG/WebP screenshots and common audio formats are accepted.',
        };
      }
    } else {
      const value = String(part.value ?? '');
      if (part.fieldname === 'text' && value.trim()) texts.push(value.slice(0, 20_000));
      else if (part.fieldname === 'url' && value.trim()) urls.push(value.slice(0, 2_048));
      else if (part.fieldname === 'locale' && (value === 'en' || value === 'hi')) locale = value;
    }
  }
  return { texts, urls, media, locale };
}

export async function registerWebRoutes(app: FastifyInstance, deps: WebRouteDeps): Promise<void> {
  app.post(
    '/api/v1/investigations',
    {
      config: {
        rateLimit: {
          max: deps.limits.perHour,
          timeWindow: '1 hour',
          keyGenerator: (req: FastifyRequest) => deps.secrets.hmac(`web:${req.ip}`),
        },
      },
    },
    async (req, reply) => {
      const input = await readInput(req, deps);
      if ('error' in input) return badRequest(reply, input.error, input.message);
      if (!input.texts.length && !input.urls.length && !input.media.length) {
        return badRequest(reply, 'empty', 'Paste the message, add a screenshot or a link.');
      }
      const created = await deps.service.create({
        channel: 'web',
        locale: input.locale,
        texts: input.texts,
        urls: input.urls,
        media: input.media,
        requesterHash: deps.secrets.hmac(`web:${req.ip}`),
        issueOwnerToken: true,
      });
      return reply.code(202).send({
        id: created.id,
        status: 'queued',
        ownerToken: created.ownerToken,
        expiresAt: created.expiresAt.toISOString(),
        links: {
          status: `/api/v1/investigations/${created.id}`,
          report: deps.service.reportUrl(created.id),
        },
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { locale?: string } }>(
    '/api/v1/investigations/:id',
    async (req, reply) => {
      if (!ID.test(req.params.id)) return reply.code(404).send({ error: { code: 'not_found' } });
      const locale = LocaleParam.safeParse(req.query.locale).data ?? null;
      const status = await deps.service.status(req.params.id, locale);
      if (!status)
        return reply.code(404).send({
          error: { code: 'not_found', message: 'This report does not exist or has expired.' },
        });
      reply.header(
        'Cache-Control',
        status.status === 'completed' ? 'private, max-age=60' : 'no-store',
      );
      return status;
    },
  );

  app.get<{ Params: { id: string }; Querystring: { locale?: string } }>(
    '/api/v1/investigations/:id/summary',
    async (req, reply) => {
      if (!ID.test(req.params.id)) return reply.code(404).send();
      const summary = await deps.service.summary(
        req.params.id,
        LocaleParam.safeParse(req.query.locale).data ?? 'en',
      );
      if (!summary) return reply.code(404).send();
      return reply
        .type('text/plain; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(summary);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { locale?: string } }>(
    '/api/v1/investigations/:id/recovery',
    async (req, reply) => {
      if (!ID.test(req.params.id)) return reply.code(404).send();
      const recovery = await deps.service.recovery(
        req.params.id,
        LocaleParam.safeParse(req.query.locale).data ?? 'en',
      );
      if (!recovery) return reply.code(404).send();
      return reply.header('Cache-Control', 'no-store').send(recovery);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/v1/investigations/:id', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!ID.test(req.params.id) || !token) return reply.code(404).send();
    const ok = await deps.service.deleteOwned(req.params.id, token);
    return reply.code(ok ? 204 : 404).send();
  });

  app.get('/api/v1/meta', async () => deps.meta());
  app.get('/api/v1/sources', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return deps.sourcesStatus();
  });
}
