import type { DomainPort, DomainRecord } from '@jaanch/core';
import type { CacheRepo } from '@jaanch/db';
import { fetchText } from '../http.js';

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, unknown]>];
}
interface RdapDomain {
  ldhName?: string;
  events?: RdapEvent[];
  entities?: RdapEntity[];
}

export function parseRdap(json: RdapDomain): {
  registeredOn: string | null;
  registrar: string | null;
} {
  const registeredOn =
    json.events?.find((e) => e.eventAction === 'registration')?.eventDate ?? null;
  const registrarEntity = json.entities?.find((e) => e.roles?.includes('registrar'));
  const fn = registrarEntity?.vcardArray?.[1]?.find((v) => v[0] === 'fn');
  const registrar = typeof fn?.[3] === 'string' && fn[3] ? fn[3] : null;
  return { registeredOn, registrar };
}

const CACHE_MS = 7 * 86_400_000;

/**
 * Domain registration dates from RDAP (the IETF successor to WHOIS), via the rdap.org
 * bootstrap redirector, which forwards to the authoritative registry for each TLD.
 */
export class RdapDomains implements DomainPort {
  constructor(
    private readonly cache: CacheRepo,
    private readonly base = 'https://rdap.org/domain/',
  ) {}

  async lookup(domain: string): Promise<DomainRecord> {
    const d = domain.toLowerCase();
    const url = `${this.base}${encodeURIComponent(d)}`;
    const cached = await this.cache.get<DomainRecord>(`rdap:${d}`);
    if (cached) return cached;
    const now = new Date().toISOString();
    const access = {
      mode: 'live' as const,
      asOf: now.slice(0, 10),
      retrievedAt: now,
      stale: false,
      isFixture: false,
    };
    try {
      const { status, text } = await fetchText(url, {
        timeoutMs: 6_000,
        retries: 1,
        maxBytes: 500_000,
        headers: { Accept: 'application/rdap+json' },
      });
      if (status === 404) {
        const rec: DomainRecord = {
          status: 'not_found',
          domain: d,
          registeredOn: null,
          registrar: null,
          access,
          rdapUrl: url,
        };
        await this.cache.set(`rdap:${d}`, rec, CACHE_MS);
        return rec;
      }
      if (status !== 200)
        return {
          status: 'unavailable',
          domain: d,
          registeredOn: null,
          registrar: null,
          access,
          rdapUrl: url,
          error: `HTTP ${status}`,
        };
      const parsed = parseRdap(JSON.parse(text) as RdapDomain);
      const rec: DomainRecord = { status: 'found', domain: d, ...parsed, access, rdapUrl: url };
      await this.cache.set(`rdap:${d}`, rec, CACHE_MS);
      return rec;
    } catch (err) {
      return {
        status: 'unavailable',
        domain: d,
        registeredOn: null,
        registrar: null,
        access,
        rdapUrl: url,
        error: String(err),
      };
    }
  }
}
