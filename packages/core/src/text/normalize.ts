/**
 * Text normalisation shared by extraction, grounding and matching.
 *
 * Two levels:
 * - `cleanText` keeps the text human-readable (used for transcripts and quotes).
 * - `foldForMatch` is lossy and only used for comparisons.
 */

const INDIC_DIGIT_BLOCKS = [
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
];

/** Characters that are invisible but can be used to break up words and evade matching. */
const INVISIBLE = /[\u00ad\u180e\u200b\u2060\u2061\u2062\u2063\u2064\ufeff]/g;
/** Joiners matter for Indic rendering, so they are only removed when folding. */
const JOINERS = /[\u200c\u200d]/g;

/** Latin look-alikes from Cyrillic and Greek that appear in spoofed brand names. */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  ո: 'n',
  ս: 'u',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
};

export function indicDigitsToAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    let mapped = ch;
    for (const start of INDIC_DIGIT_BLOCKS) {
      if (cp >= start && cp <= start + 9) {
        mapped = String(cp - start);
        break;
      }
    }
    out += mapped;
  }
  return out;
}

/** Readable normalisation: Unicode NFKC, ASCII digits, no invisible characters, tidy spaces. */
export function cleanText(input: string): string {
  return indicDigitsToAscii(input.normalize('NFKC'))
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function foldHomoglyphs(input: string): string {
  let out = '';
  for (const ch of input) out += HOMOGLYPHS[ch] ?? ch;
  return out;
}

/** Lossy folding for comparisons: lower-case, no accents/joiners/homoglyphs, single spaces. */
export function foldForMatch(input: string): string {
  return foldHomoglyphs(
    cleanText(input).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(JOINERS, '').toLowerCase(),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters and digits only (any script), used to compare identifiers written with separators. */
export function alnumOnly(input: string): string {
  return foldForMatch(input).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Truncate a value that came from an untrusted message before it is shown back to anyone. */
export function clip(input: string, max = 120): string {
  const s = cleanText(input).replace(/\s+/g, ' ');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
