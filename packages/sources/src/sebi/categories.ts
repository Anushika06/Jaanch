import type { RegistryCategory } from '@jaanch/core';

/**
 * SEBI "Recognised Intermediaries" listings, by the site's intmId. Verified against
 * https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognised=yes on 2026-10-04.
 */
export interface SebiCategoryDef {
  intmId: number;
  category: RegistryCategory;
  label: string;
}

export const SEBI_CATEGORIES: SebiCategoryDef[] = [
  { intmId: 14, category: 'RA', label: 'Research Analysts' },
  { intmId: 13, category: 'IA', label: 'Investment Advisers' },
  { intmId: 30, category: 'BROKER', label: 'Stock Brokers (equity)' },
  { intmId: 31, category: 'BROKER', label: 'Stock Brokers (equity derivatives)' },
  { intmId: 2, category: 'BROKER', label: 'Stock Brokers (commodity derivatives)' },
  { intmId: 32, category: 'BROKER', label: 'Stock Brokers (currency derivatives)' },
  { intmId: 37, category: 'BROKER', label: 'Stock Brokers (debt)' },
  { intmId: 38, category: 'BROKER', label: 'Stock Brokers (interest rate derivatives)' },
  { intmId: 33, category: 'PMS', label: 'Portfolio Managers' },
  { intmId: 9, category: 'MB', label: 'Merchant Bankers' },
  { intmId: 23, category: 'MF', label: 'Mutual Funds' },
  { intmId: 16, category: 'AIF', label: 'Alternative Investment Funds' },
  { intmId: 10, category: 'RTA', label: 'Registrars & Share Transfer Agents' },
  { intmId: 18, category: 'DP', label: 'Depository Participants (CDSL)' },
  { intmId: 19, category: 'DP', label: 'Depository Participants (NSDL)' },
  { intmId: 6, category: 'DT', label: 'Debenture Trustees' },
  { intmId: 8, category: 'KRA', label: 'KYC Registration Agencies' },
  { intmId: 7, category: 'CRA', label: 'Credit Rating Agencies' },
];

/** All current-register categories searched by a live lookup. */
export const LIVE_SEARCH_INTM_IDS = SEBI_CATEGORIES.map((c) => c.intmId).join(',');

/** Categories in SEBI's list of cancelled/surrendered/expired/suspended registrations. */
export const INACTIVE_SEARCH_INTM_IDS = '14,13,33,16,21';

export const SEBI_BASE = 'https://www.sebi.gov.in';

export function listingUrl(intmId: number): string {
  return `${SEBI_BASE}/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=${intmId}`;
}

export function exportUrl(intmId: number): string {
  return `${SEBI_BASE}/sebiweb/other/IntmExportAction.do?intmId=${intmId}`;
}

export const CATEGORY_LABELS = new Map<RegistryCategory, string>([
  ['RA', 'Research Analyst'],
  ['IA', 'Investment Adviser'],
  ['BROKER', 'Stock Broker'],
  ['PMS', 'Portfolio Manager'],
  ['MB', 'Merchant Banker'],
  ['MF', 'Mutual Fund'],
  ['AIF', 'Alternative Investment Fund'],
  ['RTA', 'Registrar & Share Transfer Agent'],
  ['DP', 'Depository Participant'],
  ['DT', 'Debenture Trustee'],
  ['KRA', 'KYC Registration Agency'],
  ['CRA', 'Credit Rating Agency'],
]);

/** Map the "Type" text SEBI shows in multi-category search results to our category. */
export function categoryFromTypeLabel(label: string): RegistryCategory | null {
  const l = label.toLowerCase();
  if (l.includes('research analyst')) return 'RA';
  if (l.includes('investment advis')) return 'IA';
  if (l.includes('stock broker')) return 'BROKER';
  if (l.includes('portfolio manager')) return 'PMS';
  if (l.includes('merchant banker')) return 'MB';
  if (l.includes('mutual fund')) return 'MF';
  if (l.includes('alternative investment')) return 'AIF';
  if (l.includes('registrar')) return 'RTA';
  if (l.includes('depository participant')) return 'DP';
  if (l.includes('debenture trustee')) return 'DT';
  if (l.includes('kyc')) return 'KRA';
  if (l.includes('credit rating')) return 'CRA';
  return null;
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** "Feb 16, 2023" → "2023-02-16"; anything else → null. */
export function parseSebiDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  return month ? `${m[3]}-${month}-${m[2]!.padStart(2, '0')}` : null;
}

/** "Feb 16, 2023 - Perpetual" → { from: '2023-02-16', to: null }. */
export function parseValidity(s: string | undefined | null): {
  from: string | null;
  to: string | null;
} {
  if (!s) return { from: null, to: null };
  const [a, b] = s.split(/\s+-\s+/);
  return { from: parseSebiDate(a), to: b && !/perpetual/i.test(b) ? parseSebiDate(b) : null };
}
