import type { Legibility, Span } from '../schemas/common.js';
import { emptyEntities, type Entities } from '../schemas/entities.js';
import type { TranscriptSegment } from '../schemas/transcript.js';
import { alnumOnly } from '../text/normalize.js';
import {
  findBankAccounts,
  findEmails,
  findHandles,
  findPhones,
  findUpiIds,
  findUrls,
} from './identifiers.js';
import { findPatterns, type PatternMatch } from './patterns.js';
import { findRegistrationNumbers } from './registration.js';

export * from './identifiers.js';
export * from './patterns.js';
export * from './registration.js';

export interface LocatedPattern extends PatternMatch {
  span: Span;
  segmentQuality: TranscriptSegment['quality'];
}

export interface DeterministicExtraction {
  entities: Entities;
  patterns: LocatedPattern[];
}

/**
 * A value read from a screenshot or audio is uncertain if the reader flagged an overlapping
 * fragment as unclear, or if the whole segment was read poorly.
 */
function legibilityOf(segment: TranscriptSegment, raw: string, reinterpreted = false): Legibility {
  if (reinterpreted) return 'uncertain';
  if (segment.origin === 'text' || segment.origin === 'url') return 'clear';
  // Speech recognition is never exact enough to rely on for identifiers.
  if (segment.origin === 'audio') return 'uncertain';
  if (segment.quality === 'poor' || segment.quality === 'unreadable') return 'uncertain';
  const value = alnumOnly(raw);
  const flagged = segment.unclearFragments.some((f) => {
    const frag = alnumOnly(f);
    return frag.length > 0 && (value.includes(frag) || frag.includes(value));
  });
  return flagged ? 'uncertain' : 'clear';
}

function span(segment: TranscriptSegment, index: number, length: number): Span {
  return { segmentId: segment.id, start: index, end: index + length };
}

/** Run every deterministic extractor over the transcript. Pure and synchronous. */
export function runDeterministicExtraction(segments: TranscriptSegment[]): DeterministicExtraction {
  const entities = emptyEntities();
  const patterns: LocatedPattern[] = [];
  const counters: Record<string, number> = {};
  const nextId = (prefix: string) =>
    `${prefix}-${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;

  // Merge identical values found in several segments into one entity with several spans.
  const index = new Map<string, { spans: Span[]; legibility?: Legibility }>();
  const remember = <T extends { spans: Span[] }>(
    key: string,
    entity: T,
    s: Span,
    legibility?: Legibility,
  ): boolean => {
    const existing = index.get(key);
    if (existing) {
      existing.spans.push(s);
      // A value read clearly anywhere counts as clear.
      if (legibility === 'clear' && existing.legibility === 'uncertain')
        existing.legibility = 'clear';
      return false;
    }
    entity.spans.push(s);
    index.set(key, { spans: entity.spans, legibility });
    return true;
  };

  for (const seg of segments) {
    const text = seg.text;

    for (const c of findRegistrationNumbers(text)) {
      const legibility = legibilityOf(seg, c.raw, c.reinterpreted);
      const entity = {
        id: '',
        raw: c.raw,
        normalized: c.normalized,
        scheme: c.scheme,
        formatValid: c.formatValid,
        legibility,
        spans: [] as Span[],
      };
      if (remember(`reg:${c.normalized}`, entity, span(seg, c.index, c.raw.length), legibility)) {
        entity.id = nextId('reg');
        entities.registrationNumbers.push(entity);
      }
    }

    for (const p of findPhones(text)) {
      const key = `phone:${p.value.e164 ?? alnumOnly(p.raw)}`;
      const legibility = legibilityOf(seg, p.raw);
      const entity = { id: '', raw: p.raw, ...p.value, legibility, spans: [] as Span[] };
      if (remember(key, entity, span(seg, p.index, p.raw.length), legibility)) {
        entity.id = nextId('phone');
        entities.phones.push(entity);
      }
    }

    for (const u of findUpiIds(text)) {
      const legibility = legibilityOf(seg, u.raw);
      const entity = { id: '', raw: u.raw, ...u.value, legibility, spans: [] as Span[] };
      if (remember(`upi:${u.value.value}`, entity, span(seg, u.index, u.raw.length), legibility)) {
        entity.id = nextId('upi');
        entities.upiIds.push(entity);
      }
    }

    for (const e of findEmails(text)) {
      const entity = { id: '', raw: e.raw, ...e.value, spans: [] as Span[] };
      if (remember(`email:${e.value.address}`, entity, span(seg, e.index, e.raw.length))) {
        entity.id = nextId('email');
        entities.emails.push(entity);
      }
    }

    for (const u of findUrls(text)) {
      const entity = { id: '', raw: u.raw, ...u.value, spans: [] as Span[] };
      if (remember(`url:${u.value.href}`, entity, span(seg, u.index, u.raw.length))) {
        entity.id = nextId('url');
        entities.urls.push(entity);
      }
    }

    for (const h of findHandles(text)) {
      const entity = { id: '', ...h.value, spans: [] as Span[] };
      if (
        remember(
          `handle:${h.value.platform}:${h.value.value}`,
          entity,
          span(seg, h.index, h.raw.length),
        )
      ) {
        entity.id = nextId('handle');
        entities.handles.push(entity);
      }
    }

    for (const b of findBankAccounts(text)) {
      const entity = { id: '', ...b.value, holderName: null, spans: [] as Span[] };
      if (
        remember(
          `bank:${b.value.maskedNumber}:${b.value.ifsc ?? ''}`,
          entity,
          span(seg, b.index, 1),
        )
      ) {
        entity.id = nextId('bank');
        entities.bankAccounts.push(entity);
      }
    }

    for (const m of findPatterns(text)) {
      patterns.push({ ...m, span: span(seg, m.index, m.length), segmentQuality: seg.quality });
    }
  }

  // Write back merged legibility.
  for (const r of entities.registrationNumbers) {
    r.legibility = index.get(`reg:${r.normalized}`)?.legibility ?? r.legibility;
  }
  return { entities, patterns };
}
