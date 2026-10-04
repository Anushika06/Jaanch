import type {
  AppInstallClaim,
  Claim,
  GuaranteedReturnsClaim,
  PaymentDestinationClaim,
  RegulatorEndorsementClaim,
  SpecialAccessClaim,
} from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import {
  CATEGORY_UPI_SUFFIX,
  OLD_UPI_DISCONTINUED_FROM,
  VALIDATED_UPI_SUFFIXES,
  type RuleId,
} from '../rules/table.js';
import { AdjudicationContext, reason } from './context.js';
import type { RegistrationOutcome } from './registration.js';

const PERIODS_PER_YEAR: Record<string, number> = { day: 365, week: 52, month: 12, year: 1 };

/** The category the message claims (or that its number resolved to), if any. */
function claimedRegisteredCategory(
  claims: Claim[],
  registrations: Map<string, RegistrationOutcome>,
): string | null {
  let sawRegistration = false;
  for (const c of claims) {
    if (c.type !== 'SEBI_REGISTRATION') continue;
    sawRegistration = true;
    const rec = registrations.get(c.id)?.record;
    if (c.category && c.category !== 'OTHER') return c.category;
    if (rec) return rec.category;
  }
  return sawRegistration ? 'UNKNOWN' : null;
}

// --------------------------------------------------------------------------------- returns

export function adjudicateReturns(
  ctx: AdjudicationContext,
  claim: GuaranteedReturnsClaim,
  claims: Claim[],
  registrations: Map<string, RegistrationOutcome>,
): void {
  if (claim.rate && PERIODS_PER_YEAR[claim.rate.period]) {
    const perYear = PERIODS_PER_YEAR[claim.rate.period]!;
    if (perYear > 1) {
      ctx.finding(`rate-math:${claim.rate.percent}:${claim.rate.period}`, {
        kind: 'pattern',
        severity: 'info',
        reason: reason('F_RETURN_RATE_MATH', {
          percent: claim.rate.percent,
          period: `@period.${claim.rate.period}`,
          annualPercent: Math.round(claim.rate.percent * perYear),
        }),
        claimIds: [claim.id],
      });
    }
  }

  if (claim.productContext === 'deposit') {
    ctx.result({ claimId: claim.id, verdict: 'CANT_CHECK', reason: reason('RETURNS_DEPOSIT') });
    return;
  }

  const category = claimedRegisteredCategory(claims, registrations);
  if (category) {
    const rules: RuleId[] =
      category === 'BROKER'
        ? ['BROKER_NO_GUARANTEED_RETURN_SCHEMES']
        : category === 'RA' || category === 'IA'
          ? ['RA_IA_NO_ASSURED_RETURNS']
          : ['RA_IA_NO_ASSURED_RETURNS', 'BROKER_NO_GUARANTEED_RETURN_SCHEMES'];
    ctx.result({
      claimId: claim.id,
      verdict: 'CONTRADICTED',
      reason: reason('RETURNS_BY_REGISTERED', { category: `@cat.${category}` }),
      ruleIds: rules,
    });
  } else {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('RETURNS_UNVERIFIABLE'),
      ruleIds: ['ASSURED_RETURN_SCHEMES_PROHIBITED'],
    });
  }
  ctx.finding('guaranteed-returns', {
    kind: 'rule',
    severity: 'high',
    reason: reason('F_GUARANTEED_RETURNS', { quote: claim.quote }),
    ruleIds: ['ASSURED_RETURN_SCHEMES_PROHIBITED'],
    claimIds: [claim.id],
  });
}

// ----------------------------------------------------------------------------- endorsement

export function adjudicateEndorsement(
  ctx: AdjudicationContext,
  claim: RegulatorEndorsementClaim,
): void {
  const object = `@obj.${claim.object}`;
  if (claim.object === 'app' || claim.object === 'group') {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('ENDORSE_APP_OR_GROUP', { authority: claim.authority, object }),
      ruleIds: ['CAUTION_SOCIAL_MEDIA_LURES'],
    });
    return;
  }
  if (claim.authority === 'SEBI') {
    ctx.result({
      claimId: claim.id,
      verdict: 'CONTRADICTED',
      reason: reason('ENDORSE_SEBI_DOES_NOT_APPROVE', { object }),
      ruleIds: ['SEBI_DOES_NOT_APPROVE_SECURITIES', 'EXCHANGES_SEBI_DO_NOT_ENDORSE'],
    });
    return;
  }
  if (claim.authority === 'NSE' || claim.authority === 'BSE') {
    ctx.result({
      claimId: claim.id,
      verdict: 'CONTRADICTED',
      reason: reason('ENDORSE_EXCHANGES_DO_NOT_ENDORSE', { authority: claim.authority, object }),
      ruleIds: ['EXCHANGES_SEBI_DO_NOT_ENDORSE'],
    });
    return;
  }
  ctx.result({
    claimId: claim.id,
    verdict: 'CANT_CHECK',
    reason: reason('ENDORSE_NOT_CHECKABLE', { authority: `@auth.${claim.authority}` }),
  });
}

// --------------------------------------------------------------------------------- payment

export function adjudicatePayment(
  ctx: AdjudicationContext,
  claim: PaymentDestinationClaim,
  claims: Claim[],
  entities: Entities,
  registrations: Map<string, RegistrationOutcome>,
): void {
  const category = claimedRegisteredCategory(claims, registrations);
  const upi = claim.upiId ? entities.upiIds.find((u) => u.id === claim.upiId) : undefined;

  if (upi) {
    const mandated =
      category !== null && (category === 'UNKNOWN' || CATEGORY_UPI_SUFFIX[category] !== undefined);
    const mandateInForce = ctx.now.toISOString().slice(0, 10) >= OLD_UPI_DISCONTINUED_FROM;
    if (!upi.validatedStructure) {
      if (mandated && mandateInForce && upi.legibility === 'clear') {
        ctx.result({
          claimId: claim.id,
          verdict: 'CONTRADICTED',
          reason: reason('UPI_NOT_VALIDATED', { upi: upi.value, category: `@cat.${category}` }),
          ruleIds: ['VALIDATED_UPI_FOR_INTERMEDIARIES'],
        });
      } else {
        ctx.result({
          claimId: claim.id,
          verdict: 'CANT_CHECK',
          reason: reason('UPI_OWNER_UNKNOWN', { upi: upi.value }),
          ...(mandated ? { ruleIds: ['VALIDATED_UPI_FOR_INTERMEDIARIES'] } : {}),
        });
      }
      if (upi.mobileNumberBased) {
        ctx.finding(`upi-personal:${upi.value}`, {
          kind: 'payment',
          severity: 'medium',
          reason: reason('F_UPI_PERSONAL', { upi: upi.value }),
          claimIds: [claim.id],
          entityIds: [upi.id],
        });
      }
      return;
    }
    // Validated structure: only SEBI Check can confirm who it belongs to.
    const expected = category && category !== 'UNKNOWN' ? CATEGORY_UPI_SUFFIX[category] : undefined;
    if (expected && upi.categorySuffix && upi.categorySuffix !== expected) {
      ctx.finding(`upi-suffix:${upi.value}`, {
        kind: 'payment',
        severity: 'medium',
        reason: reason('F_UPI_SUFFIX_DIFFERS', {
          upi: upi.value,
          suffixLabel: VALIDATED_UPI_SUFFIXES[upi.categorySuffix] ?? upi.categorySuffix,
          category: `@cat.${category}`,
        }),
        ruleIds: ['VALIDATED_UPI_FOR_INTERMEDIARIES'],
        claimIds: [claim.id],
      });
    }
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('UPI_VALIDATED_CHECK', { upi: upi.value }),
      ruleIds: ['VALIDATED_UPI_FOR_INTERMEDIARIES'],
    });
    return;
  }

  switch (claim.method) {
    case 'bank':
      ctx.result({
        claimId: claim.id,
        verdict: 'CANT_CHECK',
        reason: reason('BANK_OWNER_UNKNOWN'),
      });
      return;
    case 'qr':
      ctx.result({ claimId: claim.id, verdict: 'CANT_CHECK', reason: reason('PAYMENT_QR') });
      return;
    case 'crypto':
      ctx.result({ claimId: claim.id, verdict: 'CANT_CHECK', reason: reason('PAYMENT_CRYPTO') });
      ctx.finding('crypto-payment', {
        kind: 'payment',
        severity: 'medium',
        reason: reason('F_CRYPTO_PAYMENT'),
        claimIds: [claim.id],
      });
      return;
    default:
      ctx.result({ claimId: claim.id, verdict: 'CANT_CHECK', reason: reason('PAYMENT_OTHER') });
  }
}

// ------------------------------------------------------------------------------------- apps

export function adjudicateApp(
  ctx: AdjudicationContext,
  claim: AppInstallClaim,
  entities: Entities,
): void {
  const url = claim.urlId ? entities.urls.find((u) => u.id === claim.urlId) : undefined;
  if (url?.appStore) {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: reason('APP_STORE_CHECK_DEVELOPER', { store: `@store.${url.appStore}` }),
    });
    return;
  }
  if (claim.sideload) {
    ctx.result({
      claimId: claim.id,
      verdict: 'CANT_CHECK',
      reason: url ? reason('APP_SIDELOAD', { domain: url.host }) : reason('APP_NO_LINK'),
      ruleIds: ['CAUTION_SOCIAL_MEDIA_LURES'],
    });
    ctx.finding('app-sideload', {
      kind: 'pattern',
      severity: 'high',
      reason: reason('F_APP_SIDELOAD'),
      ruleIds: ['CAUTION_SOCIAL_MEDIA_LURES'],
      claimIds: [claim.id],
      entityIds: url ? [url.id] : [],
    });
    return;
  }
  ctx.result({ claimId: claim.id, verdict: 'CANT_CHECK', reason: reason('APP_NO_LINK') });
}

// --------------------------------------------------------------------------- special access

export function adjudicateAccess(ctx: AdjudicationContext, claim: SpecialAccessClaim): void {
  const kind = `@access.${claim.kind}`;
  if (claim.kind === 'fpi_account') {
    ctx.result({
      claimId: claim.id,
      verdict: 'CONTRADICTED',
      reason: reason('ACCESS_FPI_NOT_FOR_RESIDENTS'),
      ruleIds: ['FPI_ROUTE_NOT_FOR_RESIDENTS'],
    });
    ctx.finding('access:fpi', {
      kind: 'rule',
      severity: 'high',
      reason: reason('F_SPECIAL_ACCESS', { kind }),
      ruleIds: ['FPI_ROUTE_NOT_FOR_RESIDENTS', 'CAUTION_FAKE_INSTITUTIONAL_ACCOUNTS'],
      claimIds: [claim.id],
    });
    return;
  }
  const rules: RuleId[] =
    claim.kind === 'vip_group'
      ? ['CAUTION_VIP_GROUPS']
      : claim.kind === 'otc'
        ? []
        : claim.kind === 'institutional_account'
          ? ['CAUTION_FAKE_INSTITUTIONAL_ACCOUNTS', 'CAUTION_SOCIAL_MEDIA_LURES']
          : ['CAUTION_SOCIAL_MEDIA_LURES'];
  ctx.result({
    claimId: claim.id,
    verdict: 'CANT_CHECK',
    reason: reason(rules.length ? 'ACCESS_CAUTIONED' : 'ACCESS_UNVERIFIABLE', { kind }),
    ruleIds: rules,
  });
  ctx.finding(`access:${claim.kind}`, {
    kind: rules.length ? 'rule' : 'pattern',
    severity: claim.kind === 'vip_group' || claim.kind === 'otc' ? 'medium' : 'high',
    reason: reason('F_SPECIAL_ACCESS', { kind }),
    ruleIds: rules,
    claimIds: [claim.id],
  });
}
