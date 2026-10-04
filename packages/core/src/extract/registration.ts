import type { RegistrationScheme } from '../schemas/entities.js';

/**
 * Registration-number formats. SEBI's single-letter-prefixed numbers are "IN" + category letter
 * + 9 digits (e.g. INH000011431 for a research analyst). Formats are taken from SEBI's
 * published registers; see docs/technical-decisions.md for sources.
 */
export interface SchemeFormat {
  scheme: RegistrationScheme;
  /** Human-readable shape shown to users when a number does not fit. */
  shape: string;
  regex: RegExp;
}

export const SEBI_PREFIX_SCHEMES: Record<string, RegistrationScheme> = {
  INH: 'SEBI_RA',
  INA: 'SEBI_IA',
  INZ: 'SEBI_BROKER',
  // Pre-2017 broker registrations, still listed in SEBI's broker registers.
  INB: 'SEBI_BROKER',
  INF: 'SEBI_BROKER',
  INE: 'SEBI_BROKER',
  INP: 'SEBI_PMS',
  INM: 'SEBI_MB',
  INR: 'SEBI_RTA',
  IND: 'SEBI_DT',
};

export const SCHEME_FORMATS: SchemeFormat[] = [
  { scheme: 'SEBI_RA', shape: 'INH + 9 digits', regex: /^INH\d{9}$/ },
  { scheme: 'SEBI_IA', shape: 'INA + 9 digits', regex: /^INA\d{9}$/ },
  { scheme: 'SEBI_BROKER', shape: 'INZ + 9 digits', regex: /^IN[ZBFE]\d{9}$/ },
  { scheme: 'SEBI_PMS', shape: 'INP + 9 digits', regex: /^INP\d{9}$/ },
  { scheme: 'SEBI_MB', shape: 'INM + 9 digits', regex: /^INM\d{9}$/ },
  { scheme: 'SEBI_RTA', shape: 'INR + 9 digits', regex: /^INR\d{9}$/ },
  { scheme: 'SEBI_DT', shape: 'IND + 9 digits', regex: /^IND\d{9}$/ },
  {
    scheme: 'SEBI_DP',
    shape: 'IN-DP-…',
    regex: /^IN-DP-(?:(?:NSDL|CDSL)-)?\d{1,5}-\d{2}(?:\d{2})?$/,
  },
  { scheme: 'SEBI_MF', shape: 'MF/xxx/yy/z', regex: /^MF\/\d{3}\/\d{2}\/\d{1,2}$/ },
  {
    scheme: 'SEBI_AIF',
    shape: 'IN/AIFn/yy-yy/nnnn',
    regex: /^IN\/AIF[123]\/\d{2}-\d{2}\/\d{3,5}$/,
  },
  { scheme: 'AMFI_ARN', shape: 'ARN-number', regex: /^ARN-\d{1,7}$/ },
];

export interface RegistrationCandidate {
  raw: string;
  normalized: string;
  scheme: RegistrationScheme;
  formatValid: boolean;
  /** True when characters had to be reinterpreted (O→0, I→1…) to read the number. */
  reinterpreted: boolean;
  index: number;
}

// Characters OCR commonly confuses with digits, and their digit readings.
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  '|': '1',
  i: '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2',
  z: '2',
  G: '6',
};

const DIGITISH = '[0-9OoDQIl|iSsBZzG]';

/**
 * Single-letter SEBI prefixes followed by nine digit-like characters, tolerating separators and
 * OCR misreads. Requiring nine digit-like characters keeps ordinary words ("INDIA") out.
 */
const SEBI_LETTER_NUMBER = new RegExp(
  `(?<![A-Za-z0-9])([I1l][Nn][HAZPMRDBFEhazpmrdbfe])[\\s:.\\-–]{0,3}((?:${DIGITISH}[\\s\\-]?){8,10}${DIGITISH})(?![A-Za-z0-9])`,
  'g',
);
const DP_NUMBER =
  /(?<![A-Za-z0-9])IN[\s-]?DP[\s-]?(?:(NSDL|CDSL)[\s-]?)?(\d{1,5})[\s-](\d{4}|\d{2})(?![0-9])/gi;
const MF_NUMBER = /(?<![A-Za-z0-9])MF\s?\/\s?(\d{3})\s?\/\s?(\d{2})\s?\/\s?(\d{1,2})(?![0-9])/g;
const AIF_NUMBER =
  /(?<![A-Za-z0-9])IN\s?\/\s?AIF\s?(\d)\s?\/\s?(\d{2})\s?-\s?(\d{2})\s?\/\s?(\d{3,5})(?![0-9])/gi;
const ARN_NUMBER = /(?<![A-Za-z0-9])ARN[\s:.\-–]{0,3}(\d{1,7})(?![0-9])/gi;

function readDigits(raw: string): { digits: string; reinterpreted: boolean } {
  let digits = '';
  let reinterpreted = false;
  for (const ch of raw) {
    if (/[0-9]/.test(ch)) digits += ch;
    else if (DIGIT_LOOKALIKES[ch] !== undefined) {
      digits += DIGIT_LOOKALIKES[ch];
      reinterpreted = true;
    }
    // separators are dropped silently
  }
  return { digits, reinterpreted };
}

export function schemeForNormalized(normalized: string): {
  scheme: RegistrationScheme;
  formatValid: boolean;
} {
  for (const f of SCHEME_FORMATS) {
    if (f.regex.test(normalized)) return { scheme: f.scheme, formatValid: true };
  }
  const prefix = normalized.slice(0, 3);
  const scheme = SEBI_PREFIX_SCHEMES[prefix];
  if (scheme) return { scheme, formatValid: false };
  if (normalized.startsWith('ARN')) return { scheme: 'AMFI_ARN', formatValid: false };
  return { scheme: 'SEBI_OTHER', formatValid: false };
}

export function shapeFor(scheme: RegistrationScheme): string | null {
  return SCHEME_FORMATS.find((f) => f.scheme === scheme)?.shape ?? null;
}

export function findRegistrationNumbers(text: string): RegistrationCandidate[] {
  const found: RegistrationCandidate[] = [];

  for (const m of text.matchAll(SEBI_LETTER_NUMBER)) {
    const prefixRaw = m[1]!;
    const prefix = `IN${prefixRaw[2]!.toUpperCase()}`;
    // "INR 500000000" is far more likely an amount in rupees (and "IND 98…" a country tag before a
    // phone number) than an RTA or debenture-trustee number, which are written without a gap and
    // zero-padded (INR000001234).
    if (
      (prefix === 'INR' || prefix === 'IND') &&
      (/^\D/.test(m[0].slice(3)) || !/^[0Oo]/.test(m[2]!))
    ) {
      continue;
    }
    // "INBI" + 8 digits is a banker-to-an-issue number, not a legacy broker number.
    if (prefix === 'INB' && /^[Il|i]/.test(m[2]!)) continue;
    // Legacy INB/INF/INE numbers are written without letters; don't reinterpret OCR noise there.
    if ((prefix === 'INE' || prefix === 'INF' || prefix === 'INB') && /[^0-9\s-]/.test(m[2]!))
      continue;
    const prefixReinterpreted = prefixRaw[0] !== 'I' || prefixRaw[1] !== 'N';
    const { digits, reinterpreted } = readDigits(m[2]!);
    const normalized = `${prefix}${digits}`;
    const { scheme, formatValid } = schemeForNormalized(normalized);
    found.push({
      raw: m[0].trim(),
      normalized,
      scheme,
      formatValid,
      reinterpreted: reinterpreted || prefixReinterpreted,
      index: m.index,
    });
  }

  for (const m of text.matchAll(DP_NUMBER)) {
    const depository = m[1] ? `${m[1].toUpperCase()}-` : '';
    const normalized = `IN-DP-${depository}${m[2]}-${m[3]}`;
    found.push({
      raw: m[0].trim(),
      normalized,
      scheme: 'SEBI_DP',
      formatValid: true,
      reinterpreted: false,
      index: m.index,
    });
  }
  for (const m of text.matchAll(MF_NUMBER)) {
    const normalized = `MF/${m[1]}/${m[2]}/${m[3]}`;
    found.push({
      raw: m[0].trim(),
      normalized,
      scheme: 'SEBI_MF',
      formatValid: true,
      reinterpreted: false,
      index: m.index,
    });
  }
  for (const m of text.matchAll(AIF_NUMBER)) {
    const normalized = `IN/AIF${m[1]}/${m[2]}-${m[3]}/${m[4]}`;
    found.push({
      raw: m[0].trim(),
      normalized,
      scheme: 'SEBI_AIF',
      formatValid: true,
      reinterpreted: false,
      index: m.index,
    });
  }
  for (const m of text.matchAll(ARN_NUMBER)) {
    const normalized = `ARN-${m[1]}`;
    found.push({
      raw: m[0].trim(),
      normalized,
      scheme: 'AMFI_ARN',
      formatValid: true,
      reinterpreted: false,
      index: m.index,
    });
  }

  // De-duplicate by normalised value, keeping the first occurrence.
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((c) => (seen.has(c.normalized) ? false : (seen.add(c.normalized), true)));
}

/**
 * Alternative readings of a number that may have been misread, used only to *suggest* what the
 * number might be. A reading produced this way is always reported as uncertain.
 */
export function confusableVariants(normalized: string, limit = 12): string[] {
  const swaps: Record<string, string[]> = {
    '0': ['8', '6', '9'],
    '1': ['7', '4'],
    '3': ['8'],
    '5': ['6', '3'],
    '6': ['5', '8', '0'],
    '7': ['1'],
    '8': ['0', '3', '6', '9'],
    '9': ['8', '0'],
  };
  const head = normalized.slice(0, 3);
  const digits = normalized.slice(3);
  if (!/^\d+$/.test(digits)) return [];
  const out: string[] = [];
  for (let i = 0; i < digits.length && out.length < limit; i++) {
    for (const alt of swaps[digits[i]!] ?? []) {
      out.push(`${head}${digits.slice(0, i)}${alt}${digits.slice(i + 1)}`);
      if (out.length >= limit) break;
    }
  }
  return out;
}
