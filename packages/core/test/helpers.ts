/**
 * Test doubles for the engine. FIXTURE DATA: every registry record below is fictional and exists
 * only to exercise the adjudication logic. None of it is, or describes, a real SEBI registration.
 */
import {
  InvestigationEngine,
  type AlertListResult,
  type BlobStore,
  type DomainRecord,
  type Extractor,
  type InvestigationInput,
  type ModelExtraction,
  type ModelIdentifierReading,
  type ModelImageReading,
  type Narrator,
  type Reader,
  type RegistryCategory,
  type RegistryLookup,
  type RegistryNameSearch,
  type RegistryRecord,
  type Report,
  type SourceAccess,
  type Sources,
  compareNames,
  officialNameVariants,
} from '../src/index.js';

export const NOW = new Date('2026-10-04T10:00:00+05:30');

const listing = (id: number) =>
  `https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=${id}`;

export const FIXTURE_RECORDS: RegistryRecord[] = [
  {
    registrationNumber: 'INH000099991',
    category: 'RA',
    categoryLabel: 'Research Analyst',
    names: ['ABC RESEARCH PRIVATE LIMITED'],
    tradeNames: [],
    contactPerson: 'Anita Rao',
    emails: ['compliance@abcresearch.in'],
    phones: ['02041234567'],
    address: '12 MG Road, PUNE, MAHARASHTRA, 411001',
    city: 'PUNE',
    state: 'MAHARASHTRA',
    validFrom: '2021-05-03',
    validTo: null,
    exchanges: [],
    sourceUrl: listing(14),
  },
  {
    registrationNumber: 'INH000099993',
    category: 'RA',
    categoryLabel: 'Research Analyst',
    names: ['RAHUL KUMAR SHARMA (Proprietor: Bull Insights)'],
    tradeNames: [],
    contactPerson: null,
    emails: ['rahul.bullinsights@gmail.com'],
    phones: ['9876500001'],
    address: 'Indore, MADHYA PRADESH, 452001',
    city: 'INDORE',
    state: 'MADHYA PRADESH',
    validFrom: '2022-01-10',
    validTo: null,
    exchanges: [],
    sourceUrl: listing(14),
  },
  {
    registrationNumber: 'INZ000099992',
    category: 'BROKER',
    categoryLabel: 'Stock Broker',
    names: ['ZENITH BROKING LIMITED'],
    tradeNames: ['ZENITH'],
    contactPerson: null,
    emails: ['support@zenithbroking.com'],
    phones: ['02240001234'],
    address: 'Lower Parel, MUMBAI, MAHARASHTRA, 400013',
    city: 'MUMBAI',
    state: 'MAHARASHTRA',
    validFrom: '2015-09-30',
    validTo: null,
    exchanges: ['NATIONAL STOCK EXCHANGE OF INDIA LTD'],
    sourceUrl: listing(30),
  },
  {
    registrationNumber: 'INA000099994',
    category: 'IA',
    categoryLabel: 'Investment Adviser',
    names: ['OLD ADVISORY SERVICES LLP'],
    tradeNames: [],
    contactPerson: null,
    emails: [],
    phones: [],
    address: null,
    city: 'DELHI',
    state: null,
    validFrom: '2016-01-01',
    validTo: '2021-12-31',
    exchanges: [],
    sourceUrl: listing(13),
  },
];

const access = (overrides: Partial<SourceAccess> = {}): SourceAccess => ({
  mode: 'snapshot',
  asOf: '2026-10-03',
  retrievedAt: '2026-10-04T02:00:00Z',
  stale: false,
  isFixture: false,
  ...overrides,
});

export interface FakeSourceOptions {
  registryDown?: boolean;
  extraRecords?: RegistryRecord[];
  domains?: Record<string, string>;
  alert?: Array<{ name: string; domains: string[] }>;
}

export function fakeSources(opts: FakeSourceOptions = {}): Sources {
  const covered: RegistryCategory[] = ['RA', 'IA', 'BROKER', 'PMS'];
  return {
    registry: {
      async coveredCategories() {
        return covered;
      },
      async lookupByNumber(regNo: string): Promise<RegistryLookup> {
        if (opts.registryDown)
          return {
            status: 'unavailable',
            records: [],
            inactive: [],
            access: access({ mode: 'live' }),
            searched: [],
            error: 'down',
          };
        const records = [...FIXTURE_RECORDS, ...(opts.extraRecords ?? [])].filter(
          (r) => r.registrationNumber === regNo,
        );
        const inactive =
          regNo === 'INH000099990'
            ? [
                {
                  registrationNumber: regNo,
                  name: 'XYZ ADVISORY',
                  categoryLabel: 'Research Analyst',
                  status: 'Cancelled',
                  sourceUrl: listing(14),
                },
              ]
            : [];
        return {
          status: records.length ? 'found' : 'not_found',
          records,
          inactive,
          access: access(),
          searched: ['RA', 'IA', 'BROKER', 'PMS'],
        };
      },
      async searchByName(name: string): Promise<RegistryNameSearch> {
        if (opts.registryDown)
          return {
            status: 'unavailable',
            records: [],
            access: access({ mode: 'live' }),
            searched: [],
            error: 'down',
          };
        const records = [...FIXTURE_RECORDS, ...(opts.extraRecords ?? [])].filter(
          (r) =>
            !['different', 'inconclusive'].includes(
              compareNames(name, officialNameVariants(r)).result,
            ),
        );
        return {
          status: records.length ? 'found' : 'not_found',
          records,
          access: access(),
          searched: ['RA', 'IA', 'BROKER', 'PMS'],
        };
      },
    },
    alertList: {
      async match(q): Promise<AlertListResult> {
        const matches = (opts.alert ?? []).flatMap((e) => {
          const entry = {
            name: e.name,
            websites: e.domains,
            domains: e.domains,
            listUrl: 'https://rbi.org.in/scripts/bs_viewcontent.aspx?Id=4235',
          };
          const byDomain = q.domains
            .filter((d) => e.domains.includes(d))
            .map((d) => ({ entry, matchedOn: 'domain' as const, query: d }));
          const byName = q.names
            .filter((n) => n.toLowerCase() === e.name.toLowerCase())
            .map((n) => ({ entry, matchedOn: 'name' as const, query: n }));
          return [...byDomain, ...byName];
        });
        return { status: 'ok', matches, access: access({ asOf: '2025-11-19' }) };
      },
    },
    domains: {
      async lookup(domain: string): Promise<DomainRecord> {
        const registeredOn = opts.domains?.[domain] ?? null;
        return {
          status: registeredOn ? 'found' : 'not_found',
          domain,
          registeredOn,
          registrar: registeredOn ? 'Example Registrar' : null,
          access: access({ mode: 'live', asOf: NOW.toISOString(), retrievedAt: NOW.toISOString() }),
          rdapUrl: `https://rdap.org/domain/${domain}`,
        };
      },
    },
  };
}

export function stubExtractor(result: Partial<ModelExtraction> | Error): Extractor {
  return {
    modelId: 'stub-extractor',
    async extract() {
      if (result instanceof Error) throw result;
      return {
        investmentRelated: true,
        sender: null,
        registrationClaims: [],
        organizations: [],
        persons: [],
        endorsements: [],
        returnPromises: [],
        paymentRequests: [],
        appInstalls: [],
        specialAccess: [],
        pressure: [],
        ...result,
      };
    },
  };
}

export function stubReader(image: ModelImageReading, identifiers?: ModelIdentifierReading): Reader {
  return {
    modelId: 'stub-reader',
    async readImage() {
      return image;
    },
    ...(identifiers
      ? {
          async readIdentifiers() {
            return identifiers;
          },
        }
      : {}),
  };
}

export function memoryBlobs(): BlobStore & { discarded: string[] } {
  const discarded: string[] = [];
  return {
    discarded,
    async get() {
      return new Uint8Array([1, 2, 3]);
    },
    async discard(ref: string) {
      discarded.push(ref);
    },
  };
}

export async function investigate(
  input: Partial<InvestigationInput> & { parts: InvestigationInput['parts'] },
  ports: {
    extractor?: Extractor | null;
    reader?: Reader | null;
    narrator?: Narrator | null;
    sources?: Sources;
    blobs?: BlobStore;
  } = {},
): Promise<Report> {
  const engine = new InvestigationEngine(
    {
      reader: ports.reader ?? null,
      extractor: ports.extractor ?? null,
      narrator: ports.narrator ?? null,
      sources: ports.sources ?? fakeSources(),
      blobs: ports.blobs ?? memoryBlobs(),
      clock: () => NOW,
    },
    { sourceTimeoutMs: 2_000, modelTimeoutMs: 2_000, ocrConsensus: true, narrative: true },
  );
  return engine.run(
    { channel: input.channel ?? 'web', locale: input.locale ?? 'en', parts: input.parts },
    { id: 'J-TEST-0001', createdAt: NOW, locale: input.locale ?? 'en' },
  );
}

export function verdictOf(report: Report, type: string): string | undefined {
  const claim = report.claims.find((c) => c.type === type);
  return claim ? report.results.find((r) => r.claimId === claim.id)?.verdict : undefined;
}

export function reasonOf(report: Report, type: string): string | undefined {
  const claim = report.claims.find((c) => c.type === type);
  return claim ? report.results.find((r) => r.claimId === claim.id)?.reason.code : undefined;
}
