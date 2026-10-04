import { z } from 'zod';
import { Legibility, Span } from './common.js';

export const ClaimType = z.enum([
  'SEBI_REGISTRATION',
  'IDENTITY',
  'REGULATOR_ENDORSEMENT',
  'GUARANTEED_RETURNS',
  'PAYMENT_DESTINATION',
  'APP_INSTALL',
  'SPECIAL_ACCESS',
]);
export type ClaimType = z.infer<typeof ClaimType>;

/** Category of SEBI registration as worded in the message (not as found in the register). */
export const ClaimedCategory = z.enum(['RA', 'IA', 'BROKER', 'PMS', 'MF', 'OTHER']);
export type ClaimedCategory = z.infer<typeof ClaimedCategory>;

export const ReturnPeriod = z.enum(['day', 'week', 'month', 'year', 'trade', 'unspecified']);
export type ReturnPeriod = z.infer<typeof ReturnPeriod>;

const base = {
  id: z.string(),
  /** Verbatim text from the transcript that makes this claim. */
  quote: z.string(),
  spans: z.array(Span).default([]),
  /** Who found the claim: the language model (grounded), the deterministic patterns, or both. */
  origin: z.enum(['model', 'pattern', 'model+pattern']),
  legibility: Legibility,
};

export const SebiRegistrationClaim = z.object({
  ...base,
  type: z.literal('SEBI_REGISTRATION'),
  category: ClaimedCategory.nullable(),
  regNoId: z.string().nullable(),
  holderName: z.string().nullable(),
  /**
   * How the message ties the number to the holder name.
   * explicit: both appear in the same statement (grounded quote contains both);
   * inferred: proximity heuristics only; none: no holder name given.
   * Only `explicit` bindings can produce a CONTRADICTED name mismatch.
   */
  holderBinding: z.enum(['explicit', 'inferred', 'none']),
});
export type SebiRegistrationClaim = z.infer<typeof SebiRegistrationClaim>;

export const IdentityClaim = z.object({
  ...base,
  type: z.literal('IDENTITY'),
  orgName: z.string(),
  presentedAs: z.enum(['intermediary', 'exchange', 'regulator', 'bank', 'other']),
});
export type IdentityClaim = z.infer<typeof IdentityClaim>;

export const RegulatorEndorsementClaim = z.object({
  ...base,
  type: z.literal('REGULATOR_ENDORSEMENT'),
  authority: z.enum(['SEBI', 'RBI', 'NSE', 'BSE', 'GOVT']),
  object: z.enum(['product', 'tip', 'scheme', 'app', 'returns', 'group']),
});
export type RegulatorEndorsementClaim = z.infer<typeof RegulatorEndorsementClaim>;

export const GuaranteedReturnsClaim = z.object({
  ...base,
  type: z.literal('GUARANTEED_RETURNS'),
  kind: z.enum(['guaranteed', 'assured', 'fixed', 'risk_free', 'no_loss']),
  rate: z
    .object({
      percent: z.number().positive().max(100_000),
      period: ReturnPeriod,
    })
    .nullable(),
  productContext: z.enum(['market', 'deposit', 'unknown']),
});
export type GuaranteedReturnsClaim = z.infer<typeof GuaranteedReturnsClaim>;

export const PaymentDestinationClaim = z.object({
  ...base,
  type: z.literal('PAYMENT_DESTINATION'),
  method: z.enum(['upi', 'bank', 'qr', 'crypto', 'other']),
  upiId: z.string().nullable(),
  bankAccountId: z.string().nullable(),
});
export type PaymentDestinationClaim = z.infer<typeof PaymentDestinationClaim>;

export const AppInstallClaim = z.object({
  ...base,
  type: z.literal('APP_INSTALL'),
  appName: z.string().nullable(),
  urlId: z.string().nullable(),
  sideload: z.boolean(),
});
export type AppInstallClaim = z.infer<typeof AppInstallClaim>;

export const SpecialAccessClaim = z.object({
  ...base,
  type: z.literal('SPECIAL_ACCESS'),
  kind: z.enum([
    'institutional_account',
    'fpi_account',
    'pre_ipo',
    'ipo_allotment',
    'otc',
    'block_deal',
    'vip_group',
  ]),
});
export type SpecialAccessClaim = z.infer<typeof SpecialAccessClaim>;

export const Claim = z.discriminatedUnion('type', [
  SebiRegistrationClaim,
  IdentityClaim,
  RegulatorEndorsementClaim,
  GuaranteedReturnsClaim,
  PaymentDestinationClaim,
  AppInstallClaim,
  SpecialAccessClaim,
]);
export type Claim = z.infer<typeof Claim>;

/** Behavioural signals that are not factual claims but matter to the investor. */
export const PatternKind = z.enum([
  'URGENCY',
  'SECRECY',
  'CONTACT_SHIFT',
  'REMOTE_ACCESS_OR_OTP',
  'PAY_TO_WITHDRAW',
  'PROFIT_SCREENSHOTS',
  'CRYPTO_PAYMENT',
  'PERSONAL_ACCOUNT_PAYMENT',
  'ACCURACY_CLAIM',
]);
export type PatternKind = z.infer<typeof PatternKind>;

export const PatternHit = z.object({
  id: z.string(),
  kind: PatternKind,
  quote: z.string(),
  spans: z.array(Span).default([]),
  origin: z.enum(['model', 'pattern', 'model+pattern']),
});
export type PatternHit = z.infer<typeof PatternHit>;
