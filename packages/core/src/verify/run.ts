import type { Claim } from '../schemas/claims.js';
import type { Entities, RegistrationScheme } from '../schemas/entities.js';
import type { SourceId, SourceRun } from '../schemas/evidence.js';
import { confusableVariants } from '../extract/registration.js';
import { isRegulatorName } from '../text/names.js';
import type {
  AlertListResult,
  DomainRecord,
  RegistryCategory,
  RegistryLookup,
  RegistryNameSearch,
  RegistryRecord,
  SourceAccess,
  Sources,
} from './ports.js';

export const SCHEME_CATEGORY: Partial<Record<RegistrationScheme, RegistryCategory>> = {
  SEBI_RA: 'RA',
  SEBI_IA: 'IA',
  SEBI_BROKER: 'BROKER',
  SEBI_PMS: 'PMS',
  SEBI_MB: 'MB',
  SEBI_RTA: 'RTA',
  SEBI_DT: 'DT',
  SEBI_DP: 'DP',
  SEBI_MF: 'MF',
  SEBI_AIF: 'AIF',
};

/** Domains of large platforms: their registration age says nothing about the sender. */
const PLATFORM_DOMAINS = new Set([
  'google.com',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'whatsapp.com',
  'wa.me',
  't.me',
  'telegram.me',
  'telegram.org',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'apple.com',
  'microsoft.com',
  'gov.in',
  'nic.in',
  'sebi.gov.in',
  'rbi.org.in',
  'nseindia.com',
  'bseindia.com',
  'amazon.in',
  'amazon.com',
  'github.com',
]);

export interface VerificationOutput {
  regLookups: Map<string, RegistryLookup>;
  /** For unclear numbers that were not found: readings that do exist (snapshot only). */
  variantHits: Map<string, Array<{ variant: string; record: RegistryRecord }>>;
  nameSearches: Map<string, RegistryNameSearch>;
  alert: AlertListResult | null;
  domains: Map<string, DomainRecord>;
  coveredCategories: RegistryCategory[];
  runs: SourceRun[];
}

export interface VerificationOptions {
  timeoutMs: number;
  maxDomainLookups?: number;
}

class RunTracker {
  private readonly runs = new Map<SourceId, SourceRun>();

  record(
    sourceId: SourceId,
    ok: boolean,
    access: SourceAccess | null,
    latencyMs: number,
    unavailable: boolean,
  ) {
    const prev = this.runs.get(sourceId);
    const status: SourceRun['status'] = ok ? 'ok' : unavailable ? 'unavailable' : 'error';
    if (!prev) {
      this.runs.set(sourceId, {
        sourceId,
        status,
        mode: access?.mode ?? 'live',
        asOf: access?.asOf ?? null,
        retrievedAt: access?.retrievedAt ?? null,
        stale: access?.stale ?? false,
        isFixture: access?.isFixture ?? false,
        queries: 1,
        latencyMs: Math.round(latencyMs),
        note: null,
      });
      return;
    }
    prev.queries += 1;
    prev.latencyMs = Math.max(prev.latencyMs, Math.round(latencyMs));
    if (status === 'ok') prev.status = 'ok';
    if (access) {
      // A live answer is fresher than a snapshot; report the freshest access mode.
      if (access.mode === 'live') prev.mode = 'live';
      prev.asOf = prev.asOf ?? access.asOf;
      prev.retrievedAt = access.retrievedAt ?? prev.retrievedAt;
      prev.stale = prev.stale && access.stale;
      prev.isFixture = prev.isFixture || access.isFixture;
    }
  }

  list(): SourceRun[] {
    return [...this.runs.values()];
  }
}

async function timed<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<{ value: T | null; ms: number; error: string | null }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { value, ms: performance.now() - started, error: null };
  } catch (err) {
    return {
      value: null,
      ms: performance.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const unavailableAccess: SourceAccess = {
  mode: 'live',
  asOf: null,
  retrievedAt: null,
  stale: false,
  isFixture: false,
};

/**
 * Plan and execute every source query the claims call for. Deterministic planning: which
 * sources run depends only on the claims and entities, never on a model.
 */
export async function runVerification(
  claims: Claim[],
  entities: Entities,
  sources: Sources,
  options: VerificationOptions,
): Promise<VerificationOutput> {
  const tracker = new RunTracker();
  const out: VerificationOutput = {
    regLookups: new Map(),
    variantHits: new Map(),
    nameSearches: new Map(),
    alert: null,
    domains: new Map(),
    coveredCategories: [],
    runs: [],
  };

  const covered = await timed(() => sources.registry.coveredCategories(), options.timeoutMs);
  out.coveredCategories = covered.value ?? [];

  // ------------------------------------------------------------- registration numbers
  const regEntities = new Map(entities.registrationNumbers.map((r) => [r.id, r]));
  const numbers = new Set<string>();
  for (const c of claims) {
    if (c.type !== 'SEBI_REGISTRATION' || !c.regNoId) continue;
    const reg = regEntities.get(c.regNoId);
    if (!reg || !reg.formatValid) continue;
    const category = SCHEME_CATEGORY[reg.scheme];
    if (!category || !out.coveredCategories.includes(category)) continue;
    numbers.add(reg.normalized);
  }

  await Promise.all(
    [...numbers].map(async (n) => {
      const r = await timed(() => sources.registry.lookupByNumber(n), options.timeoutMs);
      const lookup: RegistryLookup = r.value ?? {
        status: 'unavailable',
        records: [],
        inactive: [],
        access: unavailableAccess,
        searched: [],
        error: r.error ?? 'error',
      };
      out.regLookups.set(n, lookup);
      tracker.record(
        'sebi_intermediaries',
        lookup.status !== 'unavailable',
        lookup.access,
        r.ms,
        lookup.status === 'unavailable',
      );
    }),
  );

  // Unclear numbers that were not found: try likely misreadings against the snapshot only.
  for (const reg of entities.registrationNumbers) {
    if (reg.legibility !== 'uncertain') continue;
    const lookup = out.regLookups.get(reg.normalized);
    if (!lookup || lookup.status !== 'not_found') continue;
    const hits: Array<{ variant: string; record: RegistryRecord }> = [];
    for (const variant of confusableVariants(reg.normalized)) {
      const r = await timed(
        () => sources.registry.lookupByNumber(variant, { allowLive: false }),
        options.timeoutMs,
      );
      const rec = r.value?.status === 'found' ? r.value.records[0] : undefined;
      if (rec) hits.push({ variant, record: rec });
    }
    if (hits.length) out.variantHits.set(reg.normalized, hits);
  }

  // ------------------------------------------------------------- names
  const names = new Set<string>();
  for (const c of claims) {
    if (c.type === 'SEBI_REGISTRATION' && c.holderName) {
      const reg = c.regNoId ? regEntities.get(c.regNoId) : undefined;
      const lookup = reg ? out.regLookups.get(reg.normalized) : undefined;
      // Search by name when there is no number, or when the number belongs to a different name
      // (the claimed name might itself be registered under another number).
      if (!reg || !lookup || lookup.status === 'found' || lookup.status === 'not_found')
        names.add(c.holderName);
    }
    // Brand impersonation ("Zenith Support") matters even when the message doesn't mention SEBI.
    if (c.type === 'IDENTITY' && !isRegulatorName(c.orgName)) names.add(c.orgName);
  }
  await Promise.all(
    [...names].map(async (name) => {
      const r = await timed(() => sources.registry.searchByName(name, 5), options.timeoutMs);
      const search: RegistryNameSearch = r.value ?? {
        status: 'unavailable',
        records: [],
        access: unavailableAccess,
        searched: [],
        error: r.error ?? 'error',
      };
      out.nameSearches.set(name, search);
      tracker.record(
        'sebi_intermediaries',
        search.status !== 'unavailable',
        search.access,
        r.ms,
        search.status === 'unavailable',
      );
    }),
  );

  // ------------------------------------------------------------- RBI alert list
  const alertNames = [
    ...entities.organizations
      .filter((o) => o.role !== 'regulator' && o.role !== 'exchange')
      .map((o) => o.name),
    ...entities.apps.map((a) => a.name),
  ];
  const alertDomains = [
    ...entities.urls.map((u) => u.registrableDomain).filter((d): d is string => !!d),
    ...entities.emails.filter((e) => !e.isFreeMail).map((e) => e.domain),
  ];
  if (alertNames.length || alertDomains.length) {
    const r = await timed(
      () => sources.alertList.match({ names: alertNames, domains: [...new Set(alertDomains)] }),
      options.timeoutMs,
    );
    out.alert = r.value ?? {
      status: 'unavailable',
      matches: [],
      access: unavailableAccess,
      error: r.error ?? 'error',
    };
    tracker.record(
      'rbi_alert_list',
      out.alert.status === 'ok',
      out.alert.access,
      r.ms,
      out.alert.status === 'unavailable',
    );
  }

  // ------------------------------------------------------------- domain registration age
  const domains = new Set<string>();
  for (const u of entities.urls) {
    const d = u.registrableDomain;
    if (!d || u.isShortener || u.appStore || u.messagingInvite || PLATFORM_DOMAINS.has(d)) continue;
    domains.add(d);
  }
  for (const e of entities.emails) {
    if (!e.isFreeMail && !PLATFORM_DOMAINS.has(e.domain)) domains.add(e.domain);
  }
  const limited = [...domains].slice(0, options.maxDomainLookups ?? 5);
  await Promise.all(
    limited.map(async (d) => {
      const r = await timed(() => sources.domains.lookup(d), options.timeoutMs);
      const rec: DomainRecord = r.value ?? {
        status: 'unavailable',
        domain: d,
        registeredOn: null,
        registrar: null,
        access: unavailableAccess,
        rdapUrl: null,
        error: r.error ?? 'error',
      };
      out.domains.set(d, rec);
      tracker.record(
        'domain_rdap',
        rec.status !== 'unavailable',
        rec.access,
        r.ms,
        rec.status === 'unavailable',
      );
    }),
  );

  out.runs = tracker.list();
  return out;
}
