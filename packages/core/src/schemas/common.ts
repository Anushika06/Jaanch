import { z } from 'zod';

/** Languages Jaanch can explain results in. Templates exist for every code in each locale. */
export const Locale = z.enum(['en', 'hi']);
export type Locale = z.infer<typeof Locale>;

/**
 * The only four outcomes a claim can have.
 *
 * - CONTRADICTED: an authoritative record or a cited rule positively shows something different
 *   from what the message claims. Only deterministic evidence can produce this.
 * - MATCHES: an authoritative record positively confirms the claim as the message states it.
 * - NOT_FOUND: the authoritative source that should contain it was searched; nothing was found.
 * - CANT_CHECK: the check could not be performed (no source, source down, unreadable input,
 *   or the claim is about the future). Absence of evidence is never reported as safety.
 */
export const Verdict = z.enum(['CONTRADICTED', 'MATCHES', 'NOT_FOUND', 'CANT_CHECK']);
export type Verdict = z.infer<typeof Verdict>;

export const Severity = z.enum(['high', 'medium', 'low', 'info']);
export type Severity = z.infer<typeof Severity>;

export const Channel = z.enum(['web', 'whatsapp', 'api']);
export type Channel = z.infer<typeof Channel>;

/** Position of a piece of extracted text inside a transcript segment. */
export const Span = z.object({
  segmentId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type Span = z.infer<typeof Span>;

/**
 * Whether an extracted value was read clearly. Values read from screenshots or audio that the
 * reader marked unclear, or on which two independent reads disagree, are 'uncertain' and can
 * never be the basis of a CONTRADICTED verdict.
 */
export const Legibility = z.enum(['clear', 'uncertain']);
export type Legibility = z.infer<typeof Legibility>;

export const ParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ParamValue = z.infer<typeof ParamValue>;

/**
 * A language-neutral statement: a template code plus the values to fill in. All user-facing
 * wording is produced from these codes by the explanation layer, never stored as free text.
 */
export const Reason = z.object({
  code: z.string(),
  params: z.record(z.string(), ParamValue).default({}),
});
export type Reason = z.infer<typeof Reason>;
