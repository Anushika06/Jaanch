import type { Entities } from '../schemas/entities.js';
import type { BindingStatus } from '../schemas/report.js';
import { FREE_MAIL_DOMAINS } from '../extract/identifiers.js';
import { isLookalikeDomain, registrableDomain } from '../text/domains.js';
import { compareNames, type NameComparison } from '../text/names.js';
import {
  REGISTRY_CATEGORIES,
  type RegistryCategory,
  type RegistryLookup,
  type RegistryNameSearch,
  type RegistryRecord,
  type SourceAccess,
} from '../verify/ports.js';
import { AdjudicationContext, reason } from './context.js';

/**
 * The registers a search covered, as a render parameter in the report's language: "all SEBI
 * intermediary registers", or a list of register names. Null when nothing was searched.
 */
export function registersParam(searched: readonly RegistryCategory[]): string | null {
  const unique = [...new Set(searched)];
  if (!unique.length) return null;
  if (REGISTRY_CATEGORIES.every((c) => unique.includes(c))) return '@word.all_registers';
  return `@@${unique.map((c) => `cat.${c}`).join(',')}`;
}

/** Every name under which a record may legitimately appear in a message. */
export function officialNameVariants(rec: RegistryRecord): string[] {
  const out = new Set<string>();
  for (const n of [...rec.names, ...rec.tradeNames]) {
    if (!n.trim()) continue;
    out.add(n);
    // Individual analysts are often listed as "Name (Proprietor: Brand)".
    const m = /^(.*?)\s*\((?:proprietor|prop\.?|trade\s*name)\s*[:-]?\s*(.+?)\)\s*$/i.exec(n);
    if (m) {
      if (m[1]) out.add(m[1]);
      if (m[2]) out.add(m[2]);
    }
  }
  if (rec.contactPerson) out.add(rec.contactPerson.replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, ''));
  return [...out];
}

export function displayName(rec: RegistryRecord): string {
  const legal = rec.names[0] ?? rec.registrationNumber;
  const trade = rec.tradeNames.find((t) => t && t.toLowerCase() !== legal.toLowerCase());
  return trade ? `${legal} (trade name: ${trade})` : legal;
}

export function cityOf(rec: RegistryRecord): string {
  if (rec.city) return titleCase(rec.city);
  const parts = (rec.address ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  // Addresses end with "..., CITY, STATE, PIN" in SEBI's listing.
  const city = parts.length >= 3 ? parts[parts.length - 3] : parts[parts.length - 1];
  return city ? titleCase(city) : '';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function nameComparison(
  claimedName: string | null,
  recs: RegistryRecord[],
): { result: NameComparison; matched: string | null } {
  if (!claimedName) return { result: 'inconclusive', matched: null };
  const variants = recs.flatMap(officialNameVariants);
  const r = compareNames(claimedName, variants);
  return { result: r.result, matched: r.matchedAgainst };
}

export function isActive(rec: RegistryRecord, now: Date): boolean {
  if (!rec.validTo) return true;
  return new Date(`${rec.validTo}T23:59:59+05:30`).getTime() >= now.getTime();
}

/** Register the official record as evidence; returns its id. */
export function recordEvidence(
  ctx: AdjudicationContext,
  rec: RegistryRecord,
  access: SourceAccess,
): string {
  return ctx.addEvidence(`sebi:${rec.registrationNumber}`, {
    sourceId: 'sebi_intermediaries',
    kind: 'registry_record',
    title: reason('EV_SEBI_RECORD', {
      regNo: rec.registrationNumber,
      category: `@cat.${rec.category}`,
    }),
    fields: {
      name: rec.names.join(' / ') || null,
      trade_name: rec.tradeNames.join(' / ') || null,
      registration_no: rec.registrationNumber,
      category: rec.categoryLabel,
      validity: `${rec.validFrom ?? '?'} – ${rec.validTo ?? 'Perpetual'}`,
      email: rec.emails.join(', ') || null,
      telephone: rec.phones.join(', ') || null,
      address: rec.address,
      contact_person: rec.contactPerson,
      exchange: rec.exchanges.join(', ') || null,
    },
    url: rec.sourceUrl,
    asOf: access.asOf,
    retrievedAt: access.retrievedAt,
    isFixture: access.isFixture,
  });
}

export function absenceEvidence(
  ctx: AdjudicationContext,
  query: string,
  lookup: RegistryLookup | RegistryNameSearch,
): string {
  return ctx.addEvidence(`sebi-absent:${query}`, {
    sourceId: 'sebi_intermediaries',
    kind: 'registry_absence',
    title: reason('EV_SEBI_ABSENT', { query }),
    fields: {
      searched: registersParam(lookup.searched),
      as_on: lookup.access.asOf,
      mode: lookup.access.mode,
    },
    url: 'https://www.sebi.gov.in/intermediaries.html',
    asOf: lookup.access.asOf,
    retrievedAt: lookup.access.retrievedAt,
    isFixture: lookup.access.isFixture,
  });
}

// ------------------------------------------------------------------------------- contacts

/** Last ten digits; SEBI lists phones in many shapes ("2240220322", "0917738225531"). */
export function phoneKey(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-10);
}

export function officialDomains(rec: RegistryRecord): string[] {
  const out = new Set<string>();
  for (const e of rec.emails) {
    const d = e.split('@')[1]?.toLowerCase().trim();
    if (!d || FREE_MAIL_DOMAINS.has(d)) continue;
    const reg = registrableDomain(d);
    if (reg) out.add(reg);
  }
  return [...out];
}

export interface ContactRow {
  field: 'phone' | 'email' | 'website';
  inMessage: string | null;
  inRecord: string | null;
  status: BindingStatus;
  officialDomain?: string;
}

const MESSAGING_OR_STORE = (u: Entities['urls'][number]) =>
  u.messagingInvite !== null || u.appStore !== null || u.isShortener || u.isIpHost;

/** Compare each contact channel in the message with the official record. */
export function compareContacts(entities: Entities, rec: RegistryRecord): ContactRow[] {
  const rows: ContactRow[] = [];
  const recordPhones = rec.phones.map(phoneKey).filter((p): p is string => !!p);

  const msgPhones = entities.phones.filter((p) => p.e164);
  if (msgPhones.length) {
    for (const p of msgPhones) {
      const key = phoneKey(p.e164!);
      const same = key !== null && recordPhones.includes(key);
      rows.push({
        field: 'phone',
        inMessage: p.e164,
        inRecord: rec.phones.join(', ') || null,
        status: same ? 'same' : recordPhones.length ? 'not_in_record' : 'record_has_none',
      });
    }
  } else if (rec.phones.length) {
    rows.push({
      field: 'phone',
      inMessage: null,
      inRecord: rec.phones.join(', '),
      status: 'not_given',
    });
  }

  const domains = officialDomains(rec);
  const recordEmails = rec.emails.map((e) => e.toLowerCase());
  for (const e of entities.emails) {
    const sameAddress = recordEmails.includes(e.address);
    const msgDomain = registrableDomain(e.domain) ?? e.domain;
    const sameDomain = !e.isFreeMail && domains.includes(msgDomain);
    const lookalike = domains.find((d) => isLookalikeDomain(msgDomain, d));
    rows.push({
      field: 'email',
      inMessage: e.address,
      inRecord: rec.emails.join(', ') || null,
      status:
        sameAddress || sameDomain
          ? 'same'
          : lookalike
            ? 'lookalike'
            : rec.emails.length
              ? 'not_in_record'
              : 'record_has_none',
      ...(lookalike ? { officialDomain: lookalike } : {}),
    });
  }

  const sites = entities.urls.filter((u) => !MESSAGING_OR_STORE(u) && u.registrableDomain);
  for (const u of sites) {
    const d = u.registrableDomain!;
    const lookalike = domains.find((o) => isLookalikeDomain(d, o));
    rows.push({
      field: 'website',
      inMessage: u.host,
      inRecord: domains.join(', ') || null,
      status: domains.includes(d)
        ? 'same'
        : lookalike
          ? 'lookalike'
          : domains.length
            ? 'not_in_record'
            : 'record_has_none',
      ...(lookalike ? { officialDomain: lookalike } : {}),
    });
  }
  return rows;
}
