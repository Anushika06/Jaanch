import type { Span } from '../schemas/common.js';
import { alnumOnly, foldForMatch } from './normalize.js';

export interface GroundingSegment {
  id: string;
  text: string;
}

interface Token {
  value: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}\p{M}@._\-/:]+/gu;
  for (const m of text.matchAll(re)) {
    const value = foldForMatch(m[0]).replace(/[._\-/:]+$/g, '');
    if (value) tokens.push({ value, start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * Locate a quote produced by a model inside the transcript.
 *
 * Exact (folded) containment is tried first. Otherwise the quote's words must appear in order
 * within a window of the segment, allowing for small OCR/punctuation differences: at least 85% of
 * the quote's words must be found. Returns null when the quote cannot be grounded, in which case
 * the claim it supports is discarded.
 */
export function locateQuote(quote: string, segments: GroundingSegment[]): Span | null {
  const quoteTokens = tokenize(quote).map((t) => t.value);
  if (quoteTokens.length === 0) return null;

  for (const seg of segments) {
    const tokens = tokenize(seg.text);
    if (tokens.length === 0) continue;
    const best = bestWindow(quoteTokens, tokens);
    if (best && best.ratio >= 0.85) {
      return { segmentId: seg.id, start: tokens[best.from]!.start, end: tokens[best.to]!.end };
    }
  }
  return null;
}

function bestWindow(
  quote: string[],
  tokens: Token[],
): { from: number; to: number; ratio: number } | null {
  let best: { from: number; to: number; ratio: number } | null = null;
  const maxWindow = Math.ceil(quote.length * 1.5) + 2;
  for (let start = 0; start < tokens.length; start++) {
    const t0 = tokens[start]!.value;
    if (
      !sameWord(t0, quote[0]!) &&
      !sameWord(t0, quote[1] ?? '') &&
      joinedMatch(tokens, start, quote[0]!) === 0
    )
      continue;
    // Greedy in-order matching of quote words inside a bounded window.
    let qi = 0;
    let last = start;
    let matched = 0;
    const end = Math.min(tokens.length, start + maxWindow + 4);
    for (let ti = start; ti < end && qi < quote.length; ti++) {
      if (sameWord(tokens[ti]!.value, quote[qi]!)) {
        matched++;
        qi++;
        last = ti;
        continue;
      }
      // One quote word may span several transcript words ("INH000011431" vs "INH 000 011 431").
      const joined = joinedMatch(tokens, ti, quote[qi]!);
      if (joined > 0) {
        matched++;
        qi++;
        ti += joined - 1;
        last = ti;
        continue;
      }
      // Allow one skipped quote word (an OCR'd word the model normalised differently).
      if (qi + 1 < quote.length && sameWord(tokens[ti]!.value, quote[qi + 1]!)) {
        matched++;
        qi += 2;
        last = ti;
      }
    }
    const ratio = matched / quote.length;
    if (!best || ratio > best.ratio) best = { from: start, to: last, ratio };
    if (ratio === 1) break;
  }
  return best;
}

/** Number of consecutive transcript tokens (2–5) whose concatenation equals the quote word. */
function joinedMatch(tokens: Token[], from: number, word: string): number {
  const target = alnumOnly(word);
  if (target.length < 4) return 0;
  let acc = '';
  for (let k = 0; k < 5 && from + k < tokens.length; k++) {
    acc += alnumOnly(tokens[from + k]!.value);
    if (acc === target) return k >= 1 ? k + 1 : 0;
    if (!target.startsWith(acc)) return 0;
  }
  return 0;
}

function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return alnumOnly(a) === alnumOnly(b) && alnumOnly(a).length > 0;
}

/**
 * Whether an identifier (registration number, UPI ID, phone, link) literally occurs in the
 * transcript, ignoring spaces, hyphens and case. Identifiers that do not occur are dropped.
 */
export function identifierOccurs(value: string, segments: GroundingSegment[]): boolean {
  const needle = alnumOnly(value);
  if (needle.length < 4) return false;
  return segments.some((s) => alnumOnly(s.text).includes(needle));
}

/** Span of the first literal occurrence of an identifier, tolerant of separators. */
export function locateIdentifier(value: string, segments: GroundingSegment[]): Span | null {
  const needle = alnumOnly(value);
  if (!needle) return null;
  for (const seg of segments) {
    // Map positions in the alnum-only string back to the original text.
    const positions: number[] = [];
    let compact = '';
    let i = 0;
    for (const ch of seg.text) {
      const folded = alnumOnly(ch);
      for (const c of folded) {
        compact += c;
        positions.push(i);
      }
      i += ch.length;
    }
    const at = compact.indexOf(needle);
    if (at >= 0) {
      const start = positions[at]!;
      const end = positions[at + needle.length - 1]! + 1;
      return { segmentId: seg.id, start, end };
    }
  }
  return null;
}
