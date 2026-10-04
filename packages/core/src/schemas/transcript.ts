import { z } from 'zod';

/** How well the reader could read an input part. */
export const ReadQuality = z.enum(['good', 'partial', 'poor', 'unreadable']);
export type ReadQuality = z.infer<typeof ReadQuality>;

/**
 * Normalised text produced from one input part. Every extracted entity and every claim quote
 * must be locatable inside a segment (grounding); anything that cannot be located is discarded.
 */
export const TranscriptSegment = z.object({
  id: z.string(),
  partIndex: z.number().int().nonnegative(),
  origin: z.enum(['text', 'image', 'audio', 'url']),
  text: z.string(),
  quality: ReadQuality,
  /** Substrings the reader explicitly flagged as hard to read (e.g. a smudged digit). */
  unclearFragments: z.array(z.string()).default([]),
  /** Reader that produced the text: 'verbatim' for typed text, otherwise model id. */
  readBy: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const Transcript = z.object({
  segments: z.array(TranscriptSegment),
  /** Input parts that could not be read at all, with the reason. */
  unreadParts: z.array(
    z.object({
      partIndex: z.number().int().nonnegative(),
      kind: z.enum(['image', 'audio', 'url', 'text']),
      reason: z.enum(['unsupported', 'reader_unavailable', 'unreadable', 'too_large', 'error']),
    }),
  ),
});
export type Transcript = z.infer<typeof Transcript>;
