import { z } from 'zod';
import { Reason } from './common.js';

/** Identifiers for every source Jaanch can consult. Adding a source means adding an id here. */
export const SourceId = z.enum([
  'sebi_intermediaries',
  'rbi_alert_list',
  'domain_rdap',
  'jaanch_rules',
]);
export type SourceId = z.infer<typeof SourceId>;

/**
 * One consultation of one source during an investigation, whether or not it succeeded.
 * Reports list every source run so the reader can see exactly what was and was not checked.
 */
export const SourceRun = z.object({
  sourceId: SourceId,
  status: z.enum(['ok', 'unavailable', 'error', 'skipped']),
  /** snapshot: our stored copy of a published list; live: queried during this investigation. */
  mode: z.enum(['snapshot', 'live', 'static']),
  /** Date the source itself says its data is current to (e.g. "as on Oct 03, 2026"). */
  asOf: z.string().nullable(),
  /** When Jaanch retrieved the data (snapshot ingestion time or live query time). */
  retrievedAt: z.string().nullable(),
  /** True when the data is old enough that a recent change might be missing. */
  stale: z.boolean(),
  /** True when the data came from a development fixture rather than the official source. */
  isFixture: z.boolean(),
  queries: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  note: Reason.nullable(),
});
export type SourceRun = z.infer<typeof SourceRun>;

export const EvidenceKind = z.enum([
  'registry_record', // a record exists in an official register
  'registry_absence', // the register was searched and has no such record
  'list_entry', // an entry on an official caution/alert list
  'rule', // a cited regulatory rule
  'domain_record', // registration data for a domain (RDAP)
  'derived', // a deterministic computation over other evidence (e.g. name comparison)
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/**
 * A single, traceable piece of evidence. `fields` holds the values exactly as the source
 * published them, so a reader can compare them with the original.
 */
export const Evidence = z.object({
  id: z.string(),
  sourceId: SourceId,
  kind: EvidenceKind,
  title: Reason,
  fields: z.record(z.string(), z.string().nullable()).default({}),
  /** Public URL where a person can see the same information. */
  url: z.string().nullable(),
  asOf: z.string().nullable(),
  retrievedAt: z.string().nullable(),
  isFixture: z.boolean(),
});
export type Evidence = z.infer<typeof Evidence>;
