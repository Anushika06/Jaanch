import { MetaTransport } from '../channels/whatsapp/meta.js';
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
  const provider = rt.config.whatsappProvider;
  let number: string | null = null;
  let join: string | null = null;
  if (provider === 'twilio') {
    number = rt.config.TWILIO_WHATSAPP_FROM?.replace(/^whatsapp:/, '') ?? null;
    join = rt.config.TWILIO_SANDBOX_JOIN_CODE ?? null;
  } else if (provider === 'meta' && rt.transport instanceof MetaTransport) {
    number = await rt.transport.displayNumber();
  }
  const digits = number?.replace(/\D/g, '') || null;
  return {
    whatsapp: {
      enabled: provider !== null,
      provider,
      number,
      joinCode: join,
      // Opens WhatsApp with the first message ready to send: the sandbox join phrase, or HELP.
      link: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(join ?? 'HELP')}` : null,
      sandbox: provider === 'twilio' && digits === '14155238886',
      // Meta's free test numbers (+1 555…) only reach the numbers registered in the app.
      testNumber: provider === 'meta' && Boolean(digits?.startsWith('1555')),
    },
    limits: { maxImages: rt.config.MAX_IMAGES, maxUploadMb: rt.config.MAX_UPLOAD_MB },
    reportTtlDays: rt.config.REPORT_TTL_DAYS,
    readerAvailable: Boolean(rt.llm?.reader),
    audioSupported: Boolean(rt.llm?.reader?.transcribeAudio),
    fixtureMode: rt.config.SOURCE_MODE === 'fixture',
    locales: ['en', 'hi'],
  };
}
