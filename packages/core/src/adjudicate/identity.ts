import type { Claim, IdentityClaim } from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import type { VerificationOutput } from '../verify/run.js';
import type { RegistryRecord, SourceAccess } from '../verify/ports.js';
import { isRegulatorName, isSebiName } from '../text/names.js';
import { AdjudicationContext, reason } from './context.js';
import {
  compareContacts,
  displayName,
  nameComparison,
  recordEvidence,
  registersParam,
} from './records.js';
import type { RegistrationOutcome } from './registration.js';

/**
 * Adjudicate "this message comes from <organisation>": does the party contacting the investor
 * correspond to the entity in the official record? Compares every contact channel in the
 * message with the record's published contacts.
 */
export function adjudicateIdentity(
  ctx: AdjudicationContext,
  claim: IdentityClaim,
  claims: Claim[],
  entities: Entities,
  v: VerificationOutput,
  registrations: Map<string, RegistrationOutcome>,
): void {
  const org = claim.orgName;

  // ------------------------------------------------------------ regulator impersonation
  if (isSebiName(org)) {
    const foreignEmail = entities.emails.find((e) => !e.address.endsWith('@sebi.gov.in'));
    if (foreignEmail) {
      ctx.result({
        claimId: claim.id,
        verdict: 'CONTRADICTED',
        reason: reason('ID_SEBI_EMAIL_MISMATCH', { email: foreignEmail.address }),
        ruleIds: ['SEBI_EMAIL_DOMAIN'],
      });
    } else {
      ctx.result({
        claimId: claim.id,
        verdict: 'CANT_CHECK',
        reason: reason('ID_REGULATOR_UNVERIFIED', { orgName: org }),
        ruleIds: ['SEBI_EMAIL_DOMAIN'],
      });
    }
    return;
  }
  if (isRegulatorName(org)) {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('ID_REGULATOR_UNVERIFIED', { orgName: org }),
    });
    return;
  }

  // ------------------------------------------------------------ find the official record
  let record: RegistryRecord | null = null;
  let access: SourceAccess | null = null;
  for (const c of claims) {
    if (c.type !== 'SEBI_REGISTRATION') continue;
    const outcome = registrations.get(c.id);
    if (!outcome?.record) continue;
    if (nameComparison(org, [outcome.record]).result === 'same') {
      record = outcome.record;
      access = outcome.lookup?.access ?? null;
      break;
    }
  }
  const search = v.nameSearches.get(org);
  if (!record && search && search.status === 'found') {
    const same = search.records.filter((r) => nameComparison(org, [r]).result === 'same');
    if (same.length > 1) {
      // Several registered entities share the name (e.g. a group's broking and fund arms). If the
      // message's contacts match one of them, that one is the record to compare against.
      const withContact = same.filter((r) =>
        compareContacts(entities, r).some((c) => c.status === 'same'),
      );
      if (withContact.length === 1) {
        record = withContact[0]!;
        access = search.access;
      } else {
        // Still flag websites/emails imitating any of them.
        for (const r of same) {
          for (const row of compareContacts(entities, r).filter((c) => c.status === 'lookalike')) {
            ctx.finding(`lookalike:${row.inMessage}`, {
              kind: 'domain',
              severity: 'high',
              reason: reason('F_DOMAIN_LOOKALIKE', {
                domain: row.inMessage,
                officialDomain: row.officialDomain ?? '',
                officialName: displayName(r),
              }),
              evidenceIds: [recordEvidence(ctx, r, search.access)],
              claimIds: [claim.id],
            });
          }
        }
        ctx.result({
          claimId: claim.id,
          verdict: 'CANT_CHECK',
          reason: reason('ID_AMBIGUOUS', { orgName: org, count: same.length }),
        });
        return;
      }
    }
    if (same.length === 1) {
      record = same[0]!;
      access = search.access;
    }
  }

  if (!record) {
    if (claim.presentedAs !== 'intermediary') {
      ctx.result({
        claimId: claim.id,
        verdict: 'CANT_CHECK',
        reason: reason('ID_NOT_CHECKABLE', { orgName: org }),
      });
      return;
    }
    if (!search || search.status === 'unavailable') {
      ctx.result({
        claimId: claim.id,
        verdict: 'CANT_CHECK',
        reason: reason('ID_SOURCE_UNAVAILABLE', { orgName: org }),
      });
      return;
    }
    ctx.result({
      claimId: claim.id,
      verdict: 'NOT_FOUND',
      reason: reason('ID_NOT_IN_REGISTER', { orgName: org, asOf: search.access.asOf }),
      evidenceIds: [
        ctx.addEvidence(`sebi-absent:${org}`, {
          sourceId: 'sebi_intermediaries',
          kind: 'registry_absence',
          title: reason('EV_SEBI_ABSENT', { query: org }),
          fields: {
            searched: registersParam(search.searched),
            as_on: search.access.asOf,
            mode: search.access.mode,
          },
          url: 'https://www.sebi.gov.in/intermediaries.html',
          asOf: search.access.asOf,
          retrievedAt: search.access.retrievedAt,
          isFixture: search.access.isFixture,
        }),
      ],
    });
    return;
  }

  // ------------------------------------------------------------ compare contact channels
  const ev = recordEvidence(
    ctx,
    record,
    access ?? {
      mode: 'snapshot',
      asOf: null,
      retrievedAt: null,
      stale: false,
      isFixture: ctx.fixtureMode,
    },
  );
  const rows = compareContacts(entities, record);
  const official = displayName(record);

  ctx.binding({
    claimIds: [claim.id],
    claimedName: org,
    recordEvidenceId: ev,
    officialName: official,
    registrationNumber: record.registrationNumber,
    rows: [
      { field: 'name', inMessage: org, inRecord: official, status: 'same' },
      ...rows.map((r) => ({
        field: r.field,
        inMessage: r.inMessage,
        inRecord: r.inRecord,
        status: r.status,
      })),
    ],
  });

  for (const r of rows.filter((x) => x.status === 'lookalike')) {
    ctx.finding(`lookalike:${r.inMessage}`, {
      kind: 'domain',
      severity: 'high',
      reason: reason('F_DOMAIN_LOOKALIKE', {
        domain: r.inMessage,
        officialDomain: r.officialDomain ?? '',
        officialName: official,
      }),
      evidenceIds: [ev],
      claimIds: [claim.id],
    });
  }

  const messageContacts = rows.filter((r) => r.inMessage !== null);
  const same = messageContacts.filter((r) => r.status === 'same');
  const off = messageContacts.filter(
    (r) => r.status === 'lookalike' || r.status === 'not_in_record',
  );

  if (messageContacts.length === 0) {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('ID_NO_CONTACTS', { officialName: official }),
      evidenceIds: [ev],
    });
  } else if (same.length > 0 && off.length === 0) {
    ctx.result({
      claimId: claim.id,
      verdict: 'MATCHES',
      reason: reason('ID_CONTACTS_MATCH', {
        officialName: official,
        channels: same.map((s) => s.inMessage).join(', '),
      }),
      evidenceIds: [ev],
      caveats: [reason('CAVEAT_CONTACTS_CAN_BE_COPIED')],
    });
  } else {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('ID_CONTACTS_NOT_ON_RECORD', {
        officialName: official,
        channels:
          off.map((s) => s.inMessage).join(', ') ||
          messageContacts.map((s) => s.inMessage).join(', '),
      }),
      evidenceIds: [ev],
    });
  }
}
