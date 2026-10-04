import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? def : ['true', '1', 'yes'].includes(v)));

const num = (def: number) => z.coerce.number().default(def);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: num(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(true),

  /** Public origin of this server, e.g. https://jaanch-api.onrender.com (webhook signatures, links). */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
  /** Where the web app lives, if hosted separately (e.g. Vercel). Defaults to PUBLIC_BASE_URL. */
  WEB_BASE_URL: optionalString,
  CORS_ORIGINS: optionalString,
  SERVE_WEB: bool(true),
  WEB_DIST_DIR: optionalString,

  DATABASE_URL: optionalString,
  DATA_DIR: z.string().default('.data'),
  APP_SECRET: optionalString,
  ADMIN_TOKEN: optionalString,

  SOURCE_MODE: z.enum(['live', 'fixture']).default('live'),
  SEBI_LIVE_LOOKUPS: bool(true),
  RDAP_LOOKUPS: bool(true),
  INGEST_ON_BOOT: z.enum(['auto', 'always', 'never']).default('auto'),
  INGEST_MAX_AGE_HOURS: num(24),
  SNAPSHOT_STALE_HOURS: num(72),

  REPORT_TTL_DAYS: num(7),
  MEDIA_TTL_MINUTES: num(30),
  MAX_UPLOAD_MB: num(8),
  MAX_IMAGES: num(5),
  WEB_INVESTIGATIONS_PER_HOUR: num(20),
  WHATSAPP_INVESTIGATIONS_PER_HOUR: num(15),

  LLM_PROVIDER: z.enum(['nvidia', 'none']).default('nvidia'),
  NVIDIA_API_KEY: optionalString,
  NVIDIA_BASE_URL: z.string().url().default('https://integrate.api.nvidia.com/v1'),
  LLM_VISION_MODEL: optionalString,
  LLM_TEXT_MODEL: optionalString,
  LLM_NARRATOR_MODEL: optionalString,
  LLM_ASR_MODEL: optionalString,
  LLM_TIMEOUT_MS: num(45_000),
  OCR_CONSENSUS: bool(true),
  NARRATIVE: bool(true),
  SOURCE_TIMEOUT_MS: num(12_000),

  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_WHATSAPP_FROM: optionalString,
  TWILIO_MESSAGING_SERVICE_SID: optionalString,
  TWILIO_VALIDATE_SIGNATURE: bool(true),
  TWILIO_MIN_SEND_INTERVAL_MS: num(3_000),
  TWILIO_DELETE_INBOUND_MEDIA: bool(true),
  TWILIO_CATCHUP_ON_BOOT: bool(true),
  /** Shown on the web page so people can join the sandbox, e.g. "join letter-now". */
  TWILIO_SANDBOX_JOIN_CODE: optionalString,
  WHATSAPP_COLLECT_WINDOW_MS: num(5_000),

  WORKER_ENABLED: bool(true),
  WORKER_CONCURRENCY: num(2),
  /** 0 = purely event-driven (lets serverless Postgres scale to zero). */
  WORKER_POLL_MS: num(0),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  webBaseUrl: string;
  corsOrigins: string[];
  appSecret: string;
  llmEnabled: boolean;
  twilioEnabled: boolean;
  isProduction: boolean;
}

export class ConfigError extends Error {}

/**
 * Parse and validate the environment once at startup. Fails fast with a readable message; never
 * prints secret values.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  if (isProduction) {
    const problems: string[] = [];
    if (!e.APP_SECRET || e.APP_SECRET.length < 32)
      problems.push('APP_SECRET must be set to at least 32 random characters');
    if (!e.DATABASE_URL)
      problems.push(
        'DATABASE_URL is required in production (the embedded database is for development only)',
      );
    if (e.SOURCE_MODE === 'fixture')
      problems.push('SOURCE_MODE=fixture is not allowed in production');
    if (!e.TWILIO_VALIDATE_SIGNATURE)
      problems.push('TWILIO_VALIDATE_SIGNATURE must stay enabled in production');
    if (e.PUBLIC_BASE_URL.startsWith('http://'))
      problems.push('PUBLIC_BASE_URL must be https in production');
    if (problems.length)
      throw new ConfigError(
        `Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
  }

  const twilioEnabled = Boolean(
    e.TWILIO_ACCOUNT_SID &&
    e.TWILIO_AUTH_TOKEN &&
    (e.TWILIO_WHATSAPP_FROM || e.TWILIO_MESSAGING_SERVICE_SID),
  );
  const webBaseUrl = (e.WEB_BASE_URL ?? e.PUBLIC_BASE_URL).replace(/\/$/, '');
  return {
    ...e,
    PUBLIC_BASE_URL: e.PUBLIC_BASE_URL.replace(/\/$/, ''),
    webBaseUrl,
    corsOrigins: (e.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Development fallback only; production requires APP_SECRET (checked above).
    appSecret: e.APP_SECRET ?? 'development-only-secret-do-not-use-in-production-0000',
    llmEnabled: e.LLM_PROVIDER === 'nvidia' && Boolean(e.NVIDIA_API_KEY),
    twilioEnabled,
    isProduction,
  };
}

/** Configuration summary safe to log (no secret values). */
export function describeConfig(c: Config): Record<string, unknown> {
  return {
    env: c.NODE_ENV,
    publicBaseUrl: c.PUBLIC_BASE_URL,
    webBaseUrl: c.webBaseUrl,
    database: c.DATABASE_URL ? 'postgres' : `embedded (${c.DATA_DIR})`,
    sourceMode: c.SOURCE_MODE,
    sebiLiveLookups: c.SEBI_LIVE_LOOKUPS,
    llm: c.llmEnabled ? 'nvidia' : 'disabled',
    whatsapp: c.twilioEnabled ? 'twilio' : 'disabled',
    worker: c.WORKER_ENABLED
      ? `${c.WORKER_CONCURRENCY}x${c.WORKER_POLL_MS ? `, poll ${c.WORKER_POLL_MS}ms` : ', event-driven'}`
      : 'disabled',
    adminApi: Boolean(c.ADMIN_TOKEN),
  };
}
