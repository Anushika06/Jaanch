import { foldForMatch } from './normalize.js';
import { hasDevanagari, transliterateDevanagari } from './transliterate.js';

/** Legal-form words that never distinguish one entity from another. */
const LEGAL_FORMS = new Set([
  'private',
  'pvt',
  'pvtltd',
  'limited',
  'ltd',
  'llp',
  'opc',
  'inc',
  'co',
  'company',
  'corporation',
  'corp',
  'plc',
  'the',
  'and',
  'of',
  'm',
  's',
  'ms',
  'mr',
  'mrs',
  'dr',
  'shri',
  'smt',
  'sri',
  'kumari',
  'proprietor',
  'prop',
]);

/**
 * Industry words shared by many unrelated firms ("Research", "Capital"...). Two names that share
 * only these words are not considered the same entity.
 */
const GENERIC_WORDS = new Set([
  'investment',
  'investments',
  'invest',
  'investing',
  'capital',
  'capitals',
  'securities',
  'security',
  'broking',
  'brokers',
  'broker',
  'stock',
  'stocks',
  'share',
  'shares',
  'financial',
  'finance',
  'finserv',
  'fin',
  'fintech',
  'services',
  'service',
  'advisory',
  'advisors',
  'advisers',
  'adviser',
  'advisor',
  'research',
  'analyst',
  'analysts',
  'wealth',
  'management',
  'managers',
  'asset',
  'assets',
  'consultancy',
  'consultants',
  'consulting',
  'analytics',
  'technologies',
  'technology',
  'tech',
  'solutions',
  'ventures',
  'group',
  'global',
  'india',
  'indian',
  'international',
  'enterprises',
  'enterprise',
  'associates',
  'partners',
  'markets',
  'market',
  'trading',
  'traders',
  'trade',
  'equity',
  'equities',
  'commodities',
  'commodity',
  'derivatives',
  'fund',
  'funds',
  'money',
  'portfolio',
  'holdings',
  'holding',
  'house',
  'hub',
  'academy',
  'institute',
  'team',
  'official',
  'desk',
  'support',
  'care',
  'help',
  'sebi',
  'registered',
  'ra',
  'ia',
  'pms',
]);

export interface NameTokens {
  /** Tokens that identify the entity. */
  distinctive: string[];
  /** Industry words, kept to break ties between otherwise identical names. */
  generic: string[];
}

export function nameToLatin(name: string): string {
  return hasDevanagari(name) ? transliterateDevanagari(name) : name;
}

export function tokenizeName(name: string): NameTokens {
  const folded = foldForMatch(nameToLatin(name))
    .replace(/&/g, ' and ')
    .replace(/\bpvt\.?\s*ltd\.?/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const distinctive: string[] = [];
  const generic: string[] = [];
  for (const token of folded.split(' ')) {
    if (!token || LEGAL_FORMS.has(token)) continue;
    if (GENERIC_WORDS.has(token)) generic.push(token);
    else distinctive.push(token);
  }
  return { distinctive: dedupe(distinctive), generic: dedupe(generic) };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Tokens are treated as equal when identical or, for longer tokens, nearly identical. */
export function tokensEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return jaroWinkler(a, b) >= 0.92;
}

function covered(tokens: string[], by: string[]): number {
  return tokens.filter((t) => by.some((u) => tokensEquivalent(t, u))).length;
}

export type NameComparison =
  /** The names identify the same entity (same distinctive words; subset for person names). */
  | 'same'
  /** Some identifying words are shared but the names are not the same. */
  | 'similar'
  /** No identifying word is shared. */
  | 'different'
  /** One side has no identifying words (e.g. "Research Desk"); nothing can be concluded. */
  | 'inconclusive';

export interface NameComparisonResult {
  result: NameComparison;
  /** The official name variant that produced the result. */
  matchedAgainst: string | null;
}

const RANK: Record<NameComparison, number> = { same: 3, similar: 2, different: 1, inconclusive: 0 };

/**
 * Compare a name as written in a message with every name an official record holds for the
 * entity (legal name, trade name, principal person). The most favourable comparison wins, so a
 * firm writing its own trade name is never reported as a mismatch.
 */
export function compareNames(claimed: string, officialNames: string[]): NameComparisonResult {
  const c = tokenizeName(claimed);
  let best: NameComparisonResult = { result: 'inconclusive', matchedAgainst: null };
  for (const official of officialNames) {
    if (!official.trim()) continue;
    const o = tokenizeName(official);
    const result = compareTokens(c, o);
    if (RANK[result] > RANK[best.result]) best = { result, matchedAgainst: official };
  }
  return best;
}

function compareTokens(c: NameTokens, o: NameTokens): NameComparison {
  if (c.distinctive.length === 0 || o.distinctive.length === 0) return 'inconclusive';
  const claimedCovered = covered(c.distinctive, o.distinctive);
  if (claimedCovered === 0) return 'different';

  const allClaimedCovered = claimedCovered === c.distinctive.length;
  const allOfficialCovered = covered(o.distinctive, c.distinctive) === o.distinctive.length;

  if (allClaimedCovered && allOfficialCovered) {
    // Same identifying words. If both sides also name an industry and those disagree
    // ("Sharma Capital" vs "Sharma Securities"), the names are only similar.
    if (c.generic.length && o.generic.length && covered(c.generic, o.generic) === 0) {
      return 'similar';
    }
    return 'same';
  }
  // A person's name without the middle name ("Rahul Sharma" vs "Rahul Kumar Sharma").
  if (allClaimedCovered && c.distinctive.length >= 2) return 'same';
  return 'similar';
}

const SEBI_NAME = /\b(sebi|securities\s+and\s+exchange\s+board)\b|सेबी|भारतीय\s*प्रतिभूति/i;
const OTHER_REGULATOR_NAME =
  /\b(rbi|reserve\s+bank|nse|national\s+stock\s+exchange|bse|bombay\s+stock\s+exchange|npci|amfi)\b|आरबीआई|रिज़र्व\s*बैंक/i;

/** SEBI itself, as named in a message (English or Hindi). */
export function isSebiName(name: string): boolean {
  return SEBI_NAME.test(name);
}

/** Regulators, exchanges and market institutions — never looked up as intermediaries. */
export function isRegulatorName(name: string): boolean {
  return SEBI_NAME.test(name) || OTHER_REGULATOR_NAME.test(name);
}
