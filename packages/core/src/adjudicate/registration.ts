import type { Reason } from '../schemas/common.js';
import type { SebiRegistrationClaim } from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import type { BindingStatus } from '../schemas/report.js';
import { shapeFor } from '../extract/registration.js';
import type { RegistryLookup, RegistryRecord } from '../verify/ports.js';
import { SCHEME_CATEGORY, type VerificationOutput } from '../verify/run.js';
import { AdjudicationContext, reason } from './context.js';
import {
  absenceEvidence,
  cityOf,
  compareContacts,
  displayName,
  isActive,
  nameComparison,
  recordEvidence,
  registersParam,
} from './records.js';

export interface RegistrationOutcome {
  /** Official record the claim resolved to, if any (used for channel binding). */
  record: RegistryRecord | null;
  lookup: RegistryLookup | null;
}

const NAME_STATUS: Record<string, BindingStatus> = {
  same: 'same',
  similar: 'different',
  different: 'different',
  inconclusive: 'different',
};

/**
 * Adjudicate "X is registered with SEBI (as category C) under number N".
 *
 * The key distinction this makes: a number can be real and still not belong to the party using
 * it. A real number presented under a different name is CONTRADICTED only when the message
 * explicitly ties the two together, both were read clearly, and no official name variant
 * (legal name, trade name, proprietor brand, contact person) matches.
 */
export function adjudicateRegistration(
  ctx: AdjudicationContext,
  claim: SebiRegistrationClaim,
  entities: Entities,
  v: VerificationOutput,
): RegistrationOutcome {
  const caveats: Reason[] = [];
  const reg = claim.regNoId
    ? (entities.registrationNumbers.find((r) => r.id === claim.regNoId) ?? null)
    : null;
  const category = claim.category ? `@cat.${claim.category}` : '@cat.UNKNOWN';

  // ------------------------------------------------------------ no number in the message
  if (!reg) {
    if (claim.holderName) {
      const search = v.nameSearches.get(claim.holderName);
      if (!search || search.status === 'unavailable') {
        ctx.result({
          claimId: claim.id,
          verdict: 'CANT_CHECK',
          reason: reason('REG_SOURCE_UNAVAILABLE_NAME', { claimedName: claim.holderName }),
        });
        return { record: null, lookup: null };
      }
      const matches = search.records.filter(
        (rec) => nameComparison(claim.holderName, [rec]).result === 'same',
      );
      if (matches.length === 1) {
        const rec = matches[0]!;
        const ev = recordEvidence(ctx, rec, search.access);
        ctx.result({
          claimId: claim.id,
          verdict: isActive(rec, ctx.now) ? 'MATCHES' : 'CONTRADICTED',
          reason: isActive(rec, ctx.now)
            ? reason('REG_NAME_FOUND', {
                claimedName: claim.holderName,
                officialName: displayName(rec),
                regNo: rec.registrationNumber,
                category: `@cat.${rec.category}`,
              })
            : reason('REG_EXPIRED', {
                regNo: rec.registrationNumber,
                officialName: displayName(rec),
                validTo: rec.validTo,
              }),
          evidenceIds: [ev],
          ruleIds: ['REGISTRATION_DETAILS_IN_COMMUNICATIONS'],
          caveats: [reason('CAVEAT_NO_NUMBER_GIVEN')],
        });
        bind(ctx, claim, rec, ev, entities, claim.holderName);
        return { record: rec, lookup: null };
      }
      if (matches.length > 1) {
        ctx.result({
          claimId: claim.id,
          verdict: 'CANT_CHECK',
          reason: reason('REG_NAME_AMBIGUOUS', {
            claimedName: claim.holderName,
            count: matches.length,
          }),
        });
        return { record: null, lookup: null };
      }
      const ev = absenceEvidence(ctx, claim.holderName, search);
      ctx.result({
        claimId: claim.id,
        verdict: 'NOT_FOUND',
        reason: reason('REG_NAME_NOT_FOUND', {
          claimedName: claim.holderName,
          registers: registersParam(search.searched),
          asOf: search.access.asOf,
        }),
        evidenceIds: [ev],
        caveats: staleCaveats(search.access),
      });
      return { record: null, lookup: null };
    }
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('REG_NO_DETAILS', { category }),
      ruleIds: ['REGISTRATION_DETAILS_IN_COMMUNICATIONS'],
    });
    ctx.finding('no-reg-details', {
      kind: 'registration',
      severity: 'medium',
      reason: reason('F_NO_REG_DETAILS'),
      ruleIds: ['REGISTRATION_DETAILS_IN_COMMUNICATIONS'],
      claimIds: [claim.id],
    });
    return { record: null, lookup: null };
  }

  // ------------------------------------------------------------ a number is present
  const regNo = reg.normalized;
  const registryCategory = SCHEME_CATEGORY[reg.scheme];
  if (!registryCategory || !v.coveredCategories.includes(registryCategory)) {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('REG_SCHEME_NOT_COVERED', { regNo, scheme: `@scheme.${reg.scheme}` }),
    });
    return { record: null, lookup: null };
  }
  if (!reg.formatValid) {
    if (reg.legibility === 'uncertain') {
      ctx.result({
        claimId: claim.id,
        verdict: 'CANT_CHECK',
        reason: reason('REG_UNCLEAR_NUMBER', { regNo: reg.raw }),
      });
    } else {
      ctx.result({
        claimId: claim.id,
        verdict: 'NOT_FOUND',
        reason: reason('REG_FORMAT_INVALID', { regNo: reg.raw, shape: shapeFor(reg.scheme) ?? '' }),
      });
    }
    return { record: null, lookup: null };
  }

  const lookup = v.regLookups.get(regNo);
  if (!lookup || lookup.status === 'unavailable') {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('REG_SOURCE_UNAVAILABLE', { regNo }),
    });
    return { record: null, lookup: lookup ?? null };
  }
  caveats.push(...staleCaveats(lookup.access));

  if (lookup.status === 'not_found') {
    const inactive = lookup.inactive[0];
    if (inactive && reg.legibility === 'clear') {
      const ev = ctx.addEvidence(`sebi-inactive:${regNo}`, {
        sourceId: 'sebi_intermediaries',
        kind: 'registry_record',
        title: reason('EV_SEBI_INACTIVE', { regNo, status: `@regstatus.${inactive.status}` }),
        fields: {
          name: inactive.name,
          registration_no: inactive.registrationNumber,
          category: inactive.categoryLabel,
          status: inactive.status,
        },
        url: inactive.sourceUrl,
        asOf: lookup.access.asOf,
        retrievedAt: lookup.access.retrievedAt,
        isFixture: lookup.access.isFixture,
      });
      ctx.result({
        claimId: claim.id,
        verdict: 'CONTRADICTED',
        reason: reason('REG_INACTIVE', {
          regNo,
          status: `@regstatus.${inactive.status}`,
          officialName: inactive.name,
        }),
        evidenceIds: [ev],
        caveats,
      });
      return { record: null, lookup };
    }
    const ev = absenceEvidence(ctx, regNo, lookup);
    if (reg.legibility === 'uncertain') {
      const variants = v.variantHits.get(regNo) ?? [];
      const possible = variants.length === 1 ? variants[0]! : null;
      ctx.result({
        claimId: claim.id,
        verdict: 'CANT_CHECK',
        reason: reason('REG_UNCLEAR_NUMBER', { regNo: reg.raw }),
        evidenceIds: [ev],
        caveats: possible
          ? [
              ...caveats,
              reason('CAVEAT_POSSIBLE_READING', {
                variant: possible.variant,
                officialName: displayName(possible.record),
              }),
            ]
          : caveats,
      });
      return { record: null, lookup };
    }
    ctx.result({
      claimId: claim.id,
      verdict: 'NOT_FOUND',
      reason: reason('REG_NOT_IN_REGISTER', {
        regNo,
        registers: registersParam(lookup.searched),
        asOf: lookup.access.asOf,
      }),
      evidenceIds: [ev],
      caveats,
    });
    return { record: null, lookup };
  }

  // ------------------------------------------------------------ the number exists
  const records = lookup.records;
  const rec = records[0]!;
  const ev = recordEvidence(ctx, rec, lookup.access);
  const official = displayName(rec);

  if (
    claim.category &&
    claim.category !== 'OTHER' &&
    !records.some((r) => r.category === claim.category)
  ) {
    caveats.push(
      reason('CAVEAT_CATEGORY_DIFFERS', {
        claimedCategory: `@cat.${claim.category}`,
        actualCategory: `@cat.${rec.category}`,
      }),
    );
    ctx.finding(`category-differs:${regNo}`, {
      kind: 'registration',
      severity: 'medium',
      reason: reason('F_CATEGORY_DIFFERS', {
        regNo,
        claimedCategory: `@cat.${claim.category}`,
        actualCategory: `@cat.${rec.category}`,
      }),
      evidenceIds: [ev],
      claimIds: [claim.id],
    });
  }

  if (!records.some((r) => isActive(r, ctx.now))) {
    ctx.result({
      claimId: claim.id,
      verdict: 'CONTRADICTED',
      reason: reason('REG_EXPIRED', { regNo, officialName: official, validTo: rec.validTo }),
      evidenceIds: [ev],
      caveats,
    });
    bind(ctx, claim, rec, ev, entities, claim.holderName);
    return { record: rec, lookup };
  }

  const claimed = claim.holderName;
  const comparison = nameComparison(claimed, records);

  // The claimed name may itself be a registered entity under a different number.
  if (claimed && comparison.result !== 'same') {
    const elsewhere = v.nameSearches
      .get(claimed)
      ?.records.find(
        (r) => r.registrationNumber !== regNo && nameComparison(claimed, [r]).result === 'same',
      );
    if (elsewhere) {
      caveats.push(
        reason('CAVEAT_CLAIMED_NAME_REGISTERED_ELSEWHERE', {
          claimedName: claimed,
          otherRegNo: elsewhere.registrationNumber,
        }),
      );
    }
  }

  let verdictReason: Reason;
  let verdict: 'MATCHES' | 'CONTRADICTED' | 'CANT_CHECK';
  if (!claimed || claim.holderBinding === 'none' || comparison.result === 'inconclusive') {
    verdict = 'CANT_CHECK';
    verdictReason = reason('REG_REAL_SENDER_UNKNOWN', {
      regNo,
      officialName: official,
      category: `@cat.${rec.category}`,
    });
  } else if (comparison.result === 'same') {
    verdict = 'MATCHES';
    verdictReason = rec.validTo
      ? reason('REG_MATCH', {
          regNo,
          officialName: official,
          category: `@cat.${rec.category}`,
          validTo: rec.validTo,
        })
      : reason('REG_MATCH_PERPETUAL', {
          regNo,
          officialName: official,
          category: `@cat.${rec.category}`,
        });
  } else if (comparison.result === 'similar') {
    verdict = 'CANT_CHECK';
    verdictReason = reason('REG_NAME_SIMILAR', {
      regNo,
      claimedName: claimed,
      officialName: official,
    });
  } else if (
    claim.holderBinding === 'explicit' &&
    claim.legibility === 'clear' &&
    reg.legibility === 'clear'
  ) {
    verdict = 'CONTRADICTED';
    verdictReason = reason('REG_BELONGS_TO_OTHER', {
      regNo,
      claimedName: claimed,
      officialName: official,
      officialCity: cityOf(rec),
      category: `@cat.${rec.category}`,
    });
  } else {
    verdict = 'CANT_CHECK';
    // Say why we stop short: a loose link between name and number, or an unclear reading.
    verdictReason =
      claim.holderBinding !== 'explicit'
        ? reason('REG_NAME_MISMATCH_INFERRED', {
            regNo,
            claimedName: claimed,
            officialName: official,
          })
        : reason('REG_NAME_MISMATCH_UNCERTAIN', {
            regNo,
            claimedName: claimed,
            officialName: official,
          });
  }

  ctx.result({ claimId: claim.id, verdict, reason: verdictReason, evidenceIds: [ev], caveats });
  bind(ctx, claim, rec, ev, entities, claimed, NAME_STATUS[comparison.result]);
  return { record: rec, lookup };
}

function staleCaveats(access: {
  stale: boolean;
  asOf: string | null;
  isFixture: boolean;
}): Reason[] {
  const out: Reason[] = [];
  if (access.isFixture) out.push(reason('CAVEAT_FIXTURE'));
  if (access.stale) out.push(reason('CAVEAT_SNAPSHOT_STALE', { asOf: access.asOf }));
  return out;
}

function bind(
  ctx: AdjudicationContext,
  claim: SebiRegistrationClaim,
  rec: RegistryRecord,
  evidenceId: string,
  entities: Entities,
  claimedName: string | null,
  nameStatus?: BindingStatus,
): void {
  const contacts = compareContacts(entities, rec);
  ctx.binding({
    claimIds: [claim.id],
    claimedName,
    recordEvidenceId: evidenceId,
    officialName: displayName(rec),
    registrationNumber: rec.registrationNumber,
    rows: [
      {
        field: 'name',
        inMessage: claimedName,
        inRecord: displayName(rec),
        status: claimedName
          ? (nameStatus ??
            (nameComparison(claimedName, [rec]).result === 'same' ? 'same' : 'different'))
          : 'not_given',
      },
      {
        field: 'registration',
        inMessage: claim.regNoId ? rec.registrationNumber : null,
        inRecord: rec.registrationNumber,
        status: claim.regNoId ? 'same' : 'not_given',
      },
      ...contacts.map((c) => ({
        field: c.field,
        inMessage: c.inMessage,
        inRecord: c.inRecord,
        status: c.status,
      })),
    ],
  });
}
