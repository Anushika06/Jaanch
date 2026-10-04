import path from 'node:path';
import { InvestigationEngine, type BlobStore, type Sources } from '@jaanch/core';
import {
  AlertListRepo,
  BlobsRepo,
  CacheRepo,
  InboundRepo,
  InvestigationsRepo,
  JobsRepo,
  migrate,
  openDb,
  RegistryRepo,
  SessionsRepo,
  SnapshotsRepo,
  sweepExpired,
  type Db,
} from '@jaanch/db';
import { createLlm, type LlmBundle } from '@jaanch/llm';
import { createSources, loadFixtures } from '@jaanch/sources';
import {
  WA_COLLECT_JOB,
  WA_INBOUND_JOB,
  WA_SEND_JOB,
  WhatsAppConversation,
} from './channels/whatsapp/conversation.js';
import { MetaTransport } from './channels/whatsapp/meta.js';
import type { MessagingTransport } from './channels/whatsapp/transport.js';
import { TwilioTransport } from './channels/whatsapp/twilio.js';
import type { Config } from './config.js';
import { Secrets } from './crypto.js';
import type { Logger } from './logger.js';
import { INVESTIGATION_JOB, InvestigationService } from './services/investigations.js';
import { Worker, type JobHandler } from './queue/worker.js';

export const SWEEP_JOB = 'maintenance.sweep';

export interface Runtime {
  config: Config;
  logger: Logger;
  db: Db;
  secrets: Secrets;
  repos: {
    investigations: InvestigationsRepo;
    jobs: JobsRepo;
    blobs: BlobsRepo;
    sessions: SessionsRepo;
    inbound: InboundRepo;
    snapshots: SnapshotsRepo;
    registry: RegistryRepo;
    alerts: AlertListRepo;
    cache: CacheRepo;
  };
  sources: Sources;
  llm: LlmBundle | null;
  engine: InvestigationEngine;
  service: InvestigationService;
  transport: MessagingTransport | null;
  conversation: WhatsAppConversation | null;
  worker: Worker;
  close(): Promise<void>;
}

export async function createRuntime(config: Config, logger: Logger): Promise<Runtime> {
  const db = await openDb({
    url: config.DATABASE_URL,
    // DATA_DIR=":memory:" keeps the embedded database in memory (tests).
    dataDir:
      config.DATABASE_URL || config.DATA_DIR === ':memory:'
        ? undefined
        : path.resolve(config.DATA_DIR, 'pglite'),
  });
  const applied = await migrate(db);
  if (applied.length) logger.info({ applied }, 'database migrated');

  const repos = {
    investigations: new InvestigationsRepo(db),
    jobs: new JobsRepo(db),
    blobs: new BlobsRepo(db),
    sessions: new SessionsRepo(db),
    inbound: new InboundRepo(db),
    snapshots: new SnapshotsRepo(db),
    registry: new RegistryRepo(db),
    alerts: new AlertListRepo(db),
    cache: new CacheRepo(db),
  };
  const secrets = new Secrets(config.appSecret);

  if (config.SOURCE_MODE === 'fixture') {
    await loadFixtures({
      registry: repos.registry,
      snapshots: repos.snapshots,
      alerts: repos.alerts,
    });
    logger.warn(
      {},
      'SOURCE_MODE=fixture: using FICTIONAL development data; every report will be labelled as such',
    );
  }
  const sources = createSources(db, {
    liveLookups: config.SOURCE_MODE === 'live' && config.SEBI_LIVE_LOOKUPS,
    rdap: config.RDAP_LOOKUPS,
    staleAfterHours: config.SNAPSHOT_STALE_HOURS,
  });

  const llm = config.llmEnabled
    ? createLlm({
        apiKey: config.NVIDIA_API_KEY!,
        baseUrl: config.NVIDIA_BASE_URL,
        visionModel: config.LLM_VISION_MODEL,
        textModel: config.LLM_TEXT_MODEL,
        narratorModel: config.LLM_NARRATOR_MODEL,
        asrModel: config.LLM_ASR_MODEL,
        timeoutMs: config.LLM_TIMEOUT_MS,
        logger,
      })
    : null;
  if (!llm)
    logger.warn(
      {},
      'no language model configured: screenshots cannot be read; text is checked with deterministic patterns only',
    );

  const blobStore: BlobStore = {
    get: async (ref) => (await repos.blobs.get(ref))?.bytes ?? null,
    discard: (ref) => repos.blobs.delete(ref),
  };
  const engine = new InvestigationEngine(
    {
      reader: llm?.reader ?? null,
      extractor: llm?.extractor ?? null,
      narrator: llm?.narrator ?? null,
      sources,
      blobs: blobStore,
      logger,
    },
    {
      sourceTimeoutMs: config.SOURCE_TIMEOUT_MS,
      modelTimeoutMs: config.LLM_TIMEOUT_MS,
      ocrConsensus: config.OCR_CONSENSUS,
      narrative: config.NARRATIVE,
    },
  );

  // The worker is created first so services can poke it; handlers are bound below.
  const handlers: Record<string, JobHandler> = {};
  const worker = new Worker(repos.jobs, handlers, {
    concurrency: config.WORKER_CONCURRENCY,
    pollMs: config.WORKER_POLL_MS,
    leaseMs: 10 * 60_000,
    logger,
  });
  const poke = () => worker.poke();

  let conversation: WhatsAppConversation | null = null;
  const service = new InvestigationService({
    investigations: repos.investigations,
    jobs: repos.jobs,
    blobs: repos.blobs,
    secrets,
    engine,
    logger,
    reportTtlDays: config.REPORT_TTL_DAYS,
    mediaTtlMinutes: config.MEDIA_TTL_MINUTES,
    webBaseUrl: config.webBaseUrl,
    poke,
    onCompleted: async (report, delivery) => conversation?.deliverReport(report, delivery),
    onFailed: async (_id, delivery, locale) => conversation?.deliverFailure(delivery, locale),
  });

  let transport: MessagingTransport | null = null;
  // Twilio's sandbox allows one message per 3 s; the Cloud API has no such limit, but replies are
  // still sent one at a time so they arrive in order.
  let minSendIntervalMs = config.TWILIO_MIN_SEND_INTERVAL_MS;
  let deleteInboundMedia = config.TWILIO_DELETE_INBOUND_MEDIA;
  if (config.whatsappProvider === 'twilio') {
    transport = new TwilioTransport({
      accountSid: config.TWILIO_ACCOUNT_SID!,
      authToken: config.TWILIO_AUTH_TOKEN!,
      from: config.TWILIO_WHATSAPP_FROM,
      messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID,
      statusCallbackUrl: `${config.PUBLIC_BASE_URL}/webhooks/twilio/status`,
    });
  } else if (config.whatsappProvider === 'meta') {
    transport = new MetaTransport({
      accessToken: config.META_WA_ACCESS_TOKEN!,
      phoneNumberId: config.META_WA_PHONE_NUMBER_ID!,
      appSecret: config.META_APP_SECRET,
      graphVersion: config.META_GRAPH_VERSION,
      displayNumber: config.META_WA_DISPLAY_NUMBER,
    });
    minSendIntervalMs = Math.min(minSendIntervalMs, 300);
    deleteInboundMedia = false; // received media can't be deleted through the Cloud API
  }
  if (transport) {
    conversation = new WhatsAppConversation({
      transport,
      sessions: repos.sessions,
      investigations: repos.investigations,
      service,
      jobs: repos.jobs,
      blobs: repos.blobs,
      secrets,
      logger,
      poke,
      config: {
        collectWindowMs: config.WHATSAPP_COLLECT_WINDOW_MS,
        maxImageBytes: config.MAX_UPLOAD_MB * 1024 * 1024,
        mediaTtlMinutes: config.MEDIA_TTL_MINUTES,
        reportTtlDays: config.REPORT_TTL_DAYS,
        investigationsPerHour: config.WHATSAPP_INVESTIGATIONS_PER_HOUR,
        deleteInboundMedia,
        minSendIntervalMs,
        webBaseUrl: config.webBaseUrl,
      },
    });
  }

  handlers[INVESTIGATION_JOB] = (job) =>
    service.run(
      job.payload as { investigationId: string; enc: string },
      job.attempts,
      job.maxAttempts,
    );
  handlers[SWEEP_JOB] = async () => {
    const swept = await sweepExpired(db);
    logger.info({ swept }, 'expired data swept');
  };
  if (conversation) {
    const c = conversation;
    handlers[WA_INBOUND_JOB] = (job) => c.handleInbound(job.payload as { enc: string });
    handlers[WA_COLLECT_JOB] = (job) => c.collect(job.payload as { sessionKey: string });
    handlers[WA_SEND_JOB] = (job) => c.send(job.payload as { enc: string });
  }

  return {
    config,
    logger,
    db,
    secrets,
    repos,
    sources,
    llm,
    engine,
    service,
    transport,
    conversation,
    worker,
    async close() {
      await worker.stop();
      await db.close();
    },
  };
}
