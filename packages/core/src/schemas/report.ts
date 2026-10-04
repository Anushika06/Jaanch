import { z } from 'zod';
import { Channel, Locale, Reason, Severity, Verdict } from './common.js';
import { Claim, PatternHit } from './claims.js';
import { Entities } from './entities.js';
import { Evidence, SourceId, SourceRun } from './evidence.js';
import { ReadQuality } from './transcript.js';

export const ClaimResult = z.object({
  claimId: z.string(),
  verdict: Verdict,
  reason: Reason,
  evidenceIds: z.array(z.string()).default([]),
  ruleIds: z.array(z.string()).default([]),
  /** Extra context that does not change the verdict (e.g. "category worded differently"). */
  caveats: z.array(Reason).default([]),
});
export type ClaimResult = z.infer<typeof ClaimResult>;

export const FindingKind = z.enum([
  'pattern',
  'list_hit',
  'rule',
  'domain',
  'contact',
  'payment',
  'registration',
]);
export type FindingKind = z.infer<typeof FindingKind>;

/** A warning that is not itself a claim verdict, always backed by a rule, list or pattern. */
export const Finding = z.object({
  id: z.string(),
  kind: FindingKind,
  severity: Severity,
  reason: Reason,
  evidenceIds: z.array(z.string()).default([]),
  ruleIds: z.array(z.string()).default([]),
  claimIds: z.array(z.string()).default([]),
  entityIds: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof Finding>;

/** Something Jaanch could not check, stated explicitly so silence is never read as safety. */
export const Unchecked = z.object({
  id: z.string(),
  reason: Reason,
  cause: z.enum([
    'source_unavailable',
    'no_source',
    'unclear_input',
    'unsupported_input',
    'not_verifiable',
  ]),
  sourceId: SourceId.nullable().default(null),
  claimIds: z.array(z.string()).default([]),
});
export type Unchecked = z.infer<typeof Unchecked>;

export const BindingField = z.enum(['name', 'registration', 'phone', 'email', 'website', 'upi']);
export type BindingField = z.infer<typeof BindingField>;

export const BindingStatus = z.enum([
  'same', // the message and the official record agree
  'different', // both have a value and they differ
  'lookalike', // differs but imitates the official value (e.g. domain typo-squat)
  'not_in_record', // message has a value; the record has values of this kind but not this one
  'record_has_none', // message has a value; the record lists nothing of this kind
  'not_given', // the record has a value; the message gives none
]);
export type BindingStatus = z.infer<typeof BindingStatus>;

/**
 * Channel binding: does the party contacting the investor correspond to the entity that owns
 * the official record? One row per contact channel, message value vs. record value.
 */
export const Binding = z.object({
  id: z.string(),
  claimIds: z.array(z.string()),
  claimedName: z.string().nullable(),
  recordEvidenceId: z.string(),
  officialName: z.string(),
  registrationNumber: z.string(),
  rows: z.array(
    z.object({
      field: BindingField,
      inMessage: z.string().nullable(),
      inRecord: z.string().nullable(),
      status: BindingStatus,
    }),
  ),
});
export type Binding = z.infer<typeof Binding>;

export const NextStep = z.object({
  id: z.string(),
  reason: Reason,
  priority: z.number().int(),
  href: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
});
export type NextStep = z.infer<typeof NextStep>;

export const GraphNode = z.object({
  id: z.string(),
  type: z.enum(['claim', 'entity', 'evidence', 'source', 'rule', 'finding']),
  label: z.string(),
});
export const GraphEdge = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum([
    'mentions',
    'checked_in',
    'supports',
    'contradicts',
    'absent_in',
    'cites',
    'flags',
  ]),
});
export const EvidenceGraph = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
});
export type EvidenceGraph = z.infer<typeof EvidenceGraph>;

export const VerdictCounts = z.object({
  CONTRADICTED: z.number().int().nonnegative(),
  MATCHES: z.number().int().nonnegative(),
  NOT_FOUND: z.number().int().nonnegative(),
  CANT_CHECK: z.number().int().nonnegative(),
});
export type VerdictCounts = z.infer<typeof VerdictCounts>;

export const Narrative = z.object({
  locale: Locale,
  text: z.string(),
  by: z.enum(['template', 'model']),
  model: z.string().nullable(),
});
export type Narrative = z.infer<typeof Narrative>;

export const REPORT_SCHEMA_VERSION = 1 as const;

export const Report = z.object({
  id: z.string(),
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  pipelineVersion: z.string(),
  createdAt: z.string(),
  completedAt: z.string(),
  locale: Locale,
  channel: Channel,
  input: z.object({
    parts: z.array(
      z.object({
        partIndex: z.number().int().nonnegative(),
        kind: z.enum(['text', 'image', 'audio', 'url']),
      }),
    ),
  }),
  transcript: z.array(
    z.object({
      id: z.string(),
      partIndex: z.number().int().nonnegative(),
      origin: z.enum(['text', 'image', 'audio', 'url']),
      quality: ReadQuality,
      text: z.string(),
    }),
  ),
  entities: Entities,
  claims: z.array(Claim),
  patterns: z.array(PatternHit),
  results: z.array(ClaimResult),
  findings: z.array(Finding),
  unchecked: z.array(Unchecked),
  bindings: z.array(Binding),
  evidence: z.array(Evidence),
  sources: z.array(SourceRun),
  nextSteps: z.array(NextStep),
  summary: z.object({
    counts: VerdictCounts,
    headline: Reason,
    /** True when nothing checkable was found in the input. */
    noClaims: z.boolean(),
    narrative: Narrative.nullable(),
  }),
  graph: EvidenceGraph,
  meta: z.object({
    models: z.object({
      reader: z.string().nullable(),
      extractor: z.string().nullable(),
      narrator: z.string().nullable(),
    }),
    timingsMs: z.record(z.string(), z.number()),
    fixtureMode: z.boolean(),
    /** Parts of the pipeline that ran in a reduced mode, e.g. extraction without the model. */
    degraded: z.array(Reason),
  }),
});
export type Report = z.infer<typeof Report>;
