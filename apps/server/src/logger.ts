import { pino, type Logger } from 'pino';

/**
 * Structured logging with redaction. Message content, phone numbers, tokens and credentials are
 * never logged; request logs carry method, route and status only.
 */
export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: 'jaanch' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-twilio-signature"]',
        'headers.authorization',
        '*.authToken',
        '*.apiKey',
        '*.password',
        '*.token',
        '*.ownerToken',
        '*.replyTo',
        '*.body',
        '*.text',
        '*.From',
        '*.To',
        '*.Body',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (req: { method?: string; url?: string; routeOptions?: { url?: string } }) => ({
        method: req.method,
        // Route pattern, not the concrete URL: ids and query strings stay out of logs.
        route: req.routeOptions?.url ?? (req.url ?? '').split('?')[0],
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
          },
        }
      : {}),
  });
}

export type { Logger };
