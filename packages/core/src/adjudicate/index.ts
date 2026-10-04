import type { Claim, PatternHit } from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import type { Evidence } from '../schemas/evidence.js';
import type { Binding, ClaimResult, Finding, Unchecked } from '../schemas/report.js';
import type { Transcript } from '../schemas/transcript.js';
import type { RegistryRecord } from '../verify/ports.js';
import type { VerificationOutput } from '../verify/run.js';
import {
  adjudicateAccess,
  adjudicateApp,
  adjudicateEndorsement,
  adjudicatePayment,
  adjudicateReturns,
} from './claims.js';
import { AdjudicationContext } from './context.js';
import { adjudicateIdentity } from './identity.js';
import { adjudicateRegistration, type RegistrationOutcome } from './registration.js';
import { adjudicateSignals } from './signals.js';

export { reason } from './context.js';
export { compareContacts, displayName, officialNameVariants, phoneKey } from './records.js';

export interface AdjudicationInput {
  claims: Claim[];
  patterns: PatternHit[];
  entities: Entities;
  transcript: Transcript;
  verification: VerificationOutput;
  now: Date;
  fixtureMode: boolean;
}

export interface AdjudicationOutput {
  results: ClaimResult[];
  findings: Finding[];
  unchecked: Unchecked[];
  bindings: Binding[];
  evidence: Evidence[];
  /** Official records that claims resolved to (for next steps such as "contact them officially"). */
  officialRecords: RegistryRecord[];
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 } as const;

/**
 * Turn claims plus retrieved evidence into verdicts. Pure, synchronous and deterministic: the
 * same inputs always produce the same report. No language model is involved here.
 */
export function adjudicate(input: AdjudicationInput): AdjudicationOutput {
  const { claims, patterns, entities, transcript, verification: v, now } = input;
  const ctx = new AdjudicationContext(now, input.fixtureMode);
  const registrations = new Map<string, RegistrationOutcome>();

  for (const c of claims) {
    if (c.type === 'SEBI_REGISTRATION')
      registrations.set(c.id, adjudicateRegistration(ctx, c, entities, v));
  }
  for (const c of claims) {
    switch (c.type) {
      case 'SEBI_REGISTRATION':
        break;
      case 'IDENTITY':
        adjudicateIdentity(ctx, c, claims, entities, v, registrations);
        break;
      case 'GUARANTEED_RETURNS':
        adjudicateReturns(ctx, c, claims, registrations);
        break;
      case 'REGULATOR_ENDORSEMENT':
        adjudicateEndorsement(ctx, c);
        break;
      case 'PAYMENT_DESTINATION':
        adjudicatePayment(ctx, c, claims, entities, registrations);
        break;
      case 'APP_INSTALL':
        adjudicateApp(ctx, c, entities);
        break;
      case 'SPECIAL_ACCESS':
        adjudicateAccess(ctx, c);
        break;
    }
  }
  adjudicateSignals(ctx, claims, patterns, entities, transcript, v);

  const order = new Map(claims.map((c, i) => [c.id, i]));
  const officialRecords = [...registrations.values()]
    .map((r) => r.record)
    .filter((r): r is RegistryRecord => r !== null);

  return {
    results: [...ctx.results].sort(
      (a, b) => (order.get(a.claimId) ?? 0) - (order.get(b.claimId) ?? 0),
    ),
    findings: [...ctx.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    ),
    unchecked: ctx.unchecked,
    bindings: ctx.bindings,
    evidence: ctx.evidence,
    officialRecords: dedupeRecords(officialRecords),
  };
}

function dedupeRecords(records: RegistryRecord[]): RegistryRecord[] {
  const seen = new Set<string>();
  return records.filter((r) =>
    seen.has(r.registrationNumber) ? false : (seen.add(r.registrationNumber), true),
  );
}
