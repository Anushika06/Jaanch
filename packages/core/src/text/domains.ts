import { parse } from 'tldts';
import { foldHomoglyphs } from './normalize.js';

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** "zerodha" for "kite.zerodha.com"; null when the host has no registrable domain. */
export function domainLabel(domain: string): string | null {
  const p = parse(domain);
  return p.domainWithoutSuffix ?? null;
}

export function registrableDomain(hostOrEmailDomain: string): string | null {
  return parse(hostOrEmailDomain).domain ?? null;
}

const DIGIT_TO_LETTER: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
};

function skeleton(label: string): string {
  return foldHomoglyphs(label.toLowerCase())
    .replace(/[0-9]/g, (d) => DIGIT_TO_LETTER[d] ?? d)
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[^a-z]/g, '');
}

/**
 * Whether `candidate` imitates `official` (both registrable domains): a near-identical spelling,
 * the official name with extra words ("zerodha-support.com"), or digit/homoglyph substitutions.
 * Identical domains are never look-alikes.
 */
export function isLookalikeDomain(candidate: string, official: string): boolean {
  if (candidate === official) return false;
  const c = domainLabel(candidate);
  const o = domainLabel(official);
  if (!c || !o || o.length < 4) return false;
  if (c === o) return true; // same name under a different suffix (zerodha.co vs zerodha.com)
  const cs = skeleton(c);
  const os = skeleton(o);
  if (cs === os) return true;
  if (o.length >= 5 && levenshtein(c, o) <= 2) return true;
  // Official name embedded with extra words, e.g. "zerodha-kite-support", "upstoxpro".
  const tokens = c.split(/[-_.]|(?<=\D)(?=\d)|(?<=\d)(?=\D)/).filter(Boolean);
  if (tokens.includes(o)) return true;
  return o.length >= 5 && cs.includes(os);
}
