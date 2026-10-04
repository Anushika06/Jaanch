import {
  cleanText,
  type InactiveRegistration,
  type RegistryCategory,
  type RegistryRecord,
} from '@jaanch/core';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';
import {
  CATEGORY_LABELS,
  categoryFromTypeLabel,
  listingUrl,
  parseSebiDate,
  parseValidity,
  type SebiCategoryDef,
} from './categories.js';

// ------------------------------------------------------------------------------ Excel export

export interface ParsedExport {
  title: string;
  asOf: string | null;
  rows: Array<Record<string, string>>;
}

const HEADER_KEYS: Record<string, string> = {
  Name: 'name',
  'Registration No.': 'registration_no',
  'Contact Person': 'contact_person',
  Address: 'address',
  'Email-Id': 'email',
  Telephone: 'telephone',
  Fax: 'fax',
  City: 'city',
  State: 'state',
  Pincode: 'pincode',
  From: 'valid_from',
  To: 'valid_to',
  Country: 'country',
  'Exchange Name': 'exchange_name',
  'Trade Name': 'trade_name',
};

/**
 * Parse SEBI's per-category .xls export: row 0 is the title ("Research Analyst as on Oct 03,
 * 2026"), rows 1–2 a two-level header (Address / Correspondence Address / Validity groups),
 * data from row 3.
 */
export function parseSebiExport(bytes: Uint8Array): ParsedExport {
  // Dense mode and no formatting/styles keep memory low on small (512 MB) instances.
  const wb = XLSX.read(bytes, {
    type: 'array',
    dense: true,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
  const title = String(grid[0]?.[0] ?? '').trim();
  const asOf = parseSebiDate(/as on\s+(.+)$/i.exec(title)?.[1] ?? null);

  const groups = grid[1] ?? [];
  const headers = grid[2] ?? [];
  let group = '';
  const keys = headers.map((h, i) => {
    const g = String(groups[i] ?? '').trim();
    if (g) group = g;
    else if (!String(h).trim()) group = '';
    const base =
      HEADER_KEYS[String(h).trim()] ?? String(h).trim().toLowerCase().replace(/\W+/g, '_');
    if (/correspondence/i.test(group) && base !== 'name') return `corr_${base}`;
    return base;
  });

  const rows: Array<Record<string, string>> = [];
  for (const line of grid.slice(3)) {
    const row: Record<string, string> = {};
    keys.forEach((k, i) => {
      row[k] = cleanText(String(line[i] ?? ''));
    });
    if (row.registration_no) rows.push(row);
  }
  return { title, asOf, rows };
}

const splitList = (...vals: Array<string | undefined>) => [
  ...new Set(
    vals
      .flatMap((v) => (v ?? '').split(/[,;/]\s*/))
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

export function recordsFromExport(parsed: ParsedExport, def: SebiCategoryDef): RegistryRecord[] {
  return parsed.rows.map((r) => {
    const name = r.name ?? '';
    const trade =
      r.trade_name && r.trade_name.toLowerCase() !== name.toLowerCase() ? [r.trade_name] : [];
    const addressParts = [r.address, r.city, r.state, r.pincode].filter((p) => p && p.trim());
    return {
      registrationNumber: (r.registration_no ?? '').toUpperCase().replace(/\s+/g, ''),
      category: def.category,
      categoryLabel: CATEGORY_LABELS.get(def.category) ?? def.label,
      names: name ? [name] : [],
      tradeNames: trade,
      contactPerson: r.contact_person || null,
      emails: splitList(r.email, r.corr_email)
        .filter((e) => e.includes('@'))
        .map((e) => e.toLowerCase()),
      phones: splitList(r.telephone, r.corr_telephone),
      address: addressParts.length ? addressParts.join(', ') : null,
      city: r.city || r.corr_city || null,
      state: r.state || r.corr_state || null,
      validFrom: parseSebiDate(r.valid_from),
      validTo: r.valid_to && !/perpetual/i.test(r.valid_to) ? parseSebiDate(r.valid_to) : null,
      exchanges: r.exchange_name ? [r.exchange_name] : [],
      sourceUrl: listingUrl(def.intmId),
    };
  });
}

/**
 * SEBI publishes one row per exchange/segment for brokers and has some duplicate rows; merge
 * them into one record per (registration number, category), keeping every name variant.
 */
export function mergeRecords(records: RegistryRecord[]): RegistryRecord[] {
  const byKey = new Map<string, RegistryRecord>();
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  for (const r of records) {
    if (!r.registrationNumber) continue;
    const key = `${r.category}:${r.registrationNumber}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...r });
      continue;
    }
    prev.names = union(prev.names, r.names);
    prev.tradeNames = union(prev.tradeNames, r.tradeNames).filter(
      (t) => !prev.names.some((n) => n.toLowerCase() === t.toLowerCase()),
    );
    prev.emails = union(prev.emails, r.emails);
    prev.phones = union(prev.phones, r.phones);
    prev.exchanges = union(prev.exchanges, r.exchanges);
    prev.contactPerson = prev.contactPerson ?? r.contactPerson;
    prev.address = prev.address ?? r.address;
    prev.city = prev.city ?? r.city;
    prev.state = prev.state ?? r.state;
    if (r.validFrom && (!prev.validFrom || r.validFrom < prev.validFrom))
      prev.validFrom = r.validFrom;
    // Any perpetual row makes the registration perpetual; otherwise keep the latest end date.
    prev.validTo =
      prev.validTo === null || r.validTo === null
        ? null
        : prev.validTo > r.validTo
          ? prev.validTo
          : r.validTo;
  }
  return [...byKey.values()];
}

// ------------------------------------------------------------------------------ HTML cards

export interface ParsedCards {
  total: number;
  cards: Array<Record<string, string>>;
}

/** Parse SEBI's card-view HTML (full page or AJAX fragment). */
export function parseSebiCards(html: string): ParsedCards {
  const $ = cheerio.load(html);
  const cards: Array<Record<string, string>> = [];
  $('.fixed-table-body.card-table').each((_, table) => {
    const card: Record<string, string> = {};
    $(table)
      .find('.card-view')
      .each((__, view) => {
        const label = $(view).find('.title span').first().text().replace(/\s+/g, ' ').trim();
        const value = $(view).find('.value span').first().text().replace(/\s+/g, ' ').trim();
        if (label && !(label in card)) card[label] = value;
      });
    if (card['Registration No.']) cards.push(card);
  });
  const text = $.root().text();
  const m = /(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+records/.exec(text);
  const total = m ? Number(m[3]) : /No record\(s\) available/i.test(text) ? 0 : cards.length;
  return { total, cards };
}

export function cardToRecord(
  card: Record<string, string>,
  fallback?: SebiCategoryDef,
): RegistryRecord | null {
  const regNo = (card['Registration No.'] ?? '').toUpperCase().replace(/\s+/g, '');
  const category: RegistryCategory | null =
    (card['Type'] ? categoryFromTypeLabel(card['Type']) : null) ?? fallback?.category ?? null;
  if (!regNo || !category) return null;
  const validity = parseValidity(card['Validity']);
  const address = card['Address'] || null;
  const name = card['Name'] ?? '';
  const trade =
    card['Trade Name'] && card['Trade Name'].toLowerCase() !== name.toLowerCase()
      ? [card['Trade Name']]
      : [];
  const addrParts = (address ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    registrationNumber: regNo,
    category,
    categoryLabel: CATEGORY_LABELS.get(category) ?? category,
    names: name ? [name] : [],
    tradeNames: trade,
    contactPerson: card['Contact Person'] || null,
    emails: splitList(card['E-mail'], card['Correspondence E-mail'])
      .filter((e) => e.includes('@'))
      .map((e) => e.toLowerCase()),
    phones: splitList(card['Telephone'], card['Correspondence Telephone']),
    address,
    city: addrParts.length >= 3 ? addrParts[addrParts.length - 3]! : null,
    state: addrParts.length >= 2 ? addrParts[addrParts.length - 2]! : null,
    validFrom: validity.from,
    validTo: validity.to,
    exchanges: card['Exchange Name'] ? [card['Exchange Name']] : [],
    sourceUrl: listingUrl(fallback?.intmId ?? intmIdFor(category)),
  };
}

function intmIdFor(category: RegistryCategory): number {
  const ids: Record<RegistryCategory, number> = {
    RA: 14,
    IA: 13,
    BROKER: 30,
    PMS: 33,
    MB: 9,
    MF: 23,
    AIF: 16,
    RTA: 10,
    DP: 19,
    DT: 6,
    KRA: 8,
    CRA: 7,
  };
  return ids[category];
}

export function parseInactive(html: string): InactiveRegistration[] {
  return parseSebiCards(html)
    .cards.filter((c) => c['Status'])
    .map((c) => ({
      registrationNumber: (c['Registration No.'] ?? '').toUpperCase(),
      name: c['Name'] ?? '',
      categoryLabel: c['Type'] ?? '',
      status: c['Status']!,
      sourceUrl: 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpiFilter2=yes',
    }));
}
