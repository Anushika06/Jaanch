/**
 * Contracts between the investigation engine and the sources it consults. Implementations live
 * in @jaanch/sources; the engine depends only on these interfaces, so sources can be swapped
 * (live, snapshot, fixture) without touching adjudication logic.
 */

export const REGISTRY_CATEGORIES = [
  'RA',
  'IA',
  'BROKER',
  'PMS',
  'MB',
  'MF',
  'AIF',
  'RTA',
  'DP',
  'DT',
  'KRA',
  'CRA',
] as const;
export type RegistryCategory = (typeof REGISTRY_CATEGORIES)[number];

/** Facts about one source access, used to build the report's SourceRun list. */
export interface SourceAccess {
  mode: 'snapshot' | 'live' | 'static';
  /** Date the source declares its data current to, ISO yyyy-mm-dd. */
  asOf: string | null;
  /** When Jaanch fetched the data, ISO timestamp. */
  retrievedAt: string | null;
  stale: boolean;
  isFixture: boolean;
}

/** One registered intermediary, merged across the rows SEBI publishes for it. */
export interface RegistryRecord {
  registrationNumber: string;
  category: RegistryCategory;
  categoryLabel: string;
  /** Legal names as published; several when an entity appears with different names. */
  names: string[];
  tradeNames: string[];
  contactPerson: string | null;
  emails: string[];
  phones: string[];
  address: string | null;
  city: string | null;
  state: string | null;
  validFrom: string | null;
  /** null = perpetual. */
  validTo: string | null;
  exchanges: string[];
  /** Public page where a person can see the record. */
  sourceUrl: string;
}

/** A registration SEBI lists as no longer active. */
export interface InactiveRegistration {
  registrationNumber: string;
  name: string;
  categoryLabel: string;
  status: 'Cancelled' | 'Surrendered' | 'Expired' | 'Suspended' | string;
  sourceUrl: string;
}

export type LookupStatus = 'found' | 'not_found' | 'unavailable';

export interface RegistryLookup {
  status: LookupStatus;
  records: RegistryRecord[];
  /** Present only when the number is not currently registered and SEBI lists it as inactive. */
  inactive: InactiveRegistration[];
  access: SourceAccess;
  /** Which registers were covered by the search. */
  searched: RegistryCategory[];
  error?: string;
}

export interface RegistryNameSearch {
  status: LookupStatus;
  records: RegistryRecord[];
  access: SourceAccess;
  searched: RegistryCategory[];
  error?: string;
}

export interface RegistryPort {
  /**
   * Look a number up. Implementations answer from their snapshot first and may confirm a miss
   * against the live register; `allowLive: false` restricts the lookup to the snapshot (used
   * for speculative lookups such as alternative readings of an unclear number).
   */
  lookupByNumber(
    registrationNumber: string,
    options?: { allowLive?: boolean },
  ): Promise<RegistryLookup>;
  searchByName(name: string, limit?: number): Promise<RegistryNameSearch>;
  /** Categories the registry can answer for. A number outside these is "can't check". */
  coveredCategories(): Promise<RegistryCategory[]>;
}

export interface AlertListEntry {
  name: string;
  websites: string[];
  domains: string[];
  listUrl: string;
}

export interface AlertListMatch {
  entry: AlertListEntry;
  matchedOn: 'name' | 'domain';
  query: string;
}

export interface AlertListResult {
  status: 'ok' | 'unavailable';
  matches: AlertListMatch[];
  access: SourceAccess;
  error?: string;
}

export interface AlertListPort {
  /** Match organisation/app names and domains against the RBI Alert List. */
  match(query: { names: string[]; domains: string[] }): Promise<AlertListResult>;
}

export interface DomainRecord {
  status: LookupStatus;
  domain: string;
  registeredOn: string | null;
  registrar: string | null;
  access: SourceAccess;
  rdapUrl: string | null;
  error?: string;
}

export interface DomainPort {
  lookup(domain: string): Promise<DomainRecord>;
}

export interface Sources {
  registry: RegistryPort;
  alertList: AlertListPort;
  domains: DomainPort;
}

/** Category metadata shared by adapters and the explanation layer. */
export const REGISTRY_CATEGORY_LABELS: Record<RegistryCategory, string> = {
  RA: 'Research Analyst',
  IA: 'Investment Adviser',
  BROKER: 'Stock Broker',
  PMS: 'Portfolio Manager',
  MB: 'Merchant Banker',
  MF: 'Mutual Fund',
  AIF: 'Alternative Investment Fund',
  RTA: 'Registrar & Share Transfer Agent',
  DP: 'Depository Participant',
  DT: 'Debenture Trustee',
  KRA: 'KYC Registration Agency',
  CRA: 'Credit Rating Agency',
};
