import { RBI_ALERT_SOURCE_ID, RBI_ALERT_URL, SEBI_SOURCE_ID } from '@jaanch/sources';
import type { Runtime } from '../runtime.js';

/** Public, secret-free description of what Jaanch checks against and how fresh it is. */
export async function sourcesStatus(rt: Runtime): Promise<Record<string, unknown>> {
  const [sebi, rbi] = await Promise.all([
    rt.repos.snapshots.latestSucceeded(SEBI_SOURCE_ID),
    rt.repos.snapshots.latestSucceeded(RBI_ALERT_SOURCE_ID),
  ]);
  const counts = await rt.repos.registry.countByCategory('sebi');
  return {
    sebi: {
      name: 'SEBI register of intermediaries',
      url: 'https://www.sebi.gov.in/intermediaries.html',
      liveLookups: rt.config.SOURCE_MODE === 'live' && rt.config.SEBI_LIVE_LOOKUPS,
      categories: sebi.map((s) => ({
        category: s.scope,
        asOf: s.asOf,
        retrievedAt: s.completedAt?.toISOString() ?? null,
        records: counts[s.scope] ?? s.recordCount ?? 0,
        isFixture: s.isFixture,
      })),
    },
    rbiAlertList: {
      name: 'RBI Alert List (unauthorised forex platforms)',
      url: RBI_ALERT_URL,
      asOf: rbi[0]?.asOf ?? null,
      retrievedAt: rbi[0]?.completedAt?.toISOString() ?? null,
      entries: rbi[0]?.recordCount ?? 0,
      isFixture: rbi[0]?.isFixture ?? false,
    },
    rdap: { enabled: rt.config.RDAP_LOOKUPS, url: 'https://rdap.org' },
    rules: { verifiedOn: '2026-10-04' },
    reader: rt.llm ? { provider: 'nvidia-nim', models: rt.llm.models } : null,
    fixtureMode: rt.config.SOURCE_MODE === 'fixture',
  };
}

export async function publicMeta(rt: Runtime): Promise<Record<string, unknown>> {
  const from = rt.config.TWILIO_WHATSAPP_FROM?.replace(/^whatsapp:/, '') ?? null;
  const digits = from?.replace(/\D/g, '') ?? null;
  const join = rt.config.TWILIO_SANDBOX_JOIN_CODE ?? null;
  return {
    whatsapp: {
      enabled: rt.config.twilioEnabled,
      number: from,
      joinCode: join,
      link: digits
        ? `https://wa.me/${digits}${join ? `?text=${encodeURIComponent(join)}` : ''}`
        : null,
      sandbox: digits === '14155238886',
    },
    limits: { maxImages: rt.config.MAX_IMAGES, maxUploadMb: rt.config.MAX_UPLOAD_MB },
    reportTtlDays: rt.config.REPORT_TTL_DAYS,
    readerAvailable: Boolean(rt.llm?.reader),
    audioSupported: Boolean(rt.llm?.reader?.transcribeAudio),
    fixtureMode: rt.config.SOURCE_MODE === 'fixture',
    locales: ['en', 'hi'],
  };
}
