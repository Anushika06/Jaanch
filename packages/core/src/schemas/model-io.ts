import { z } from 'zod';

/**
 * Contracts between the engine and language-model adapters. Model output is untrusted: it is
 * validated against these schemas, then every quote and identifier is grounded against the
 * transcript before anything reaches adjudication. Models never produce verdicts.
 */

const quote = z.string().min(1).max(600);

/** Output of reading one screenshot (OCR + layout understanding). */
export const ModelImageReading = z.object({
  text: z.string().max(20_000),
  quality: z.enum(['good', 'partial', 'poor', 'unreadable']),
  /** Exact substrings of `text` that were hard to read (blurred digits, cut-off words). */
  unclear: z.array(z.string().max(200)).max(50).default([]),
});
export type ModelImageReading = z.infer<typeof ModelImageReading>;

/** Independent second read of only the critical identifiers, used for consensus checking. */
export const ModelIdentifierReading = z.object({
  registrationNumbers: z.array(z.string().max(60)).max(20).default([]),
  upiIds: z.array(z.string().max(120)).max(20).default([]),
  phoneNumbers: z.array(z.string().max(40)).max(20).default([]),
  links: z.array(z.string().max(500)).max(20).default([]),
});
export type ModelIdentifierReading = z.infer<typeof ModelIdentifierReading>;

export const ModelExtraction = z.object({
  investmentRelated: z.boolean(),
  sender: z
    .object({
      name: z.string().max(200),
      quote,
    })
    .nullable()
    .default(null),
  registrationClaims: z
    .array(
      z.object({
        regulator: z.enum(['SEBI', 'AMFI', 'RBI', 'NSE', 'BSE', 'OTHER']),
        category: z.enum([
          'research_analyst',
          'investment_adviser',
          'stock_broker',
          'portfolio_manager',
          'mutual_fund',
          'other',
          'unspecified',
        ]),
        number: z.string().max(60).nullable(),
        holderName: z.string().max(200).nullable(),
        quote,
      }),
    )
    .max(10)
    .default([]),
  organizations: z
    .array(
      z.object({
        name: z.string().max(200),
        role: z.enum(['sender', 'mentioned', 'regulator', 'exchange', 'platform']),
        quote,
      }),
    )
    .max(15)
    .default([]),
  persons: z
    .array(
      z.object({
        name: z.string().max(120),
        title: z.string().max(120).nullable(),
        quote,
      }),
    )
    .max(10)
    .default([]),
  endorsements: z
    .array(
      z.object({
        authority: z.enum(['SEBI', 'RBI', 'NSE', 'BSE', 'GOVT']),
        object: z.enum([
          'entity_registration',
          'product',
          'tip',
          'scheme',
          'app',
          'returns',
          'group',
        ]),
        quote,
      }),
    )
    .max(10)
    .default([]),
  returnPromises: z
    .array(
      z.object({
        kind: z.enum([
          'guaranteed',
          'assured',
          'fixed',
          'risk_free',
          'no_loss',
          'high_unqualified',
        ]),
        percent: z.number().positive().max(100_000).nullable(),
        period: z.enum(['day', 'week', 'month', 'year', 'trade', 'unspecified']),
        product: z.enum([
          'stocks',
          'derivatives',
          'ipo',
          'crypto',
          'forex',
          'mutual_fund',
          'fixed_deposit',
          'bond',
          'other',
          'unknown',
        ]),
        quote,
      }),
    )
    .max(10)
    .default([]),
  paymentRequests: z
    .array(
      z.object({
        method: z.enum(['upi', 'bank', 'qr', 'crypto', 'other']),
        destination: z.string().max(200).nullable(),
        quote,
      }),
    )
    .max(10)
    .default([]),
  appInstalls: z
    .array(
      z.object({
        appName: z.string().max(120).nullable(),
        link: z.string().max(500).nullable(),
        quote,
      }),
    )
    .max(10)
    .default([]),
  specialAccess: z
    .array(
      z.object({
        kind: z.enum([
          'institutional_account',
          'fpi_account',
          'pre_ipo',
          'ipo_allotment',
          'otc',
          'block_deal',
          'vip_group',
        ]),
        quote,
      }),
    )
    .max(10)
    .default([]),
  pressure: z
    .array(
      z.object({
        kind: z.enum([
          'urgency',
          'secrecy',
          'contact_shift',
          'remote_access_or_otp',
          'pay_to_withdraw',
          'profit_screenshots',
        ]),
        quote,
      }),
    )
    .max(15)
    .default([]),
});
export type ModelExtraction = z.infer<typeof ModelExtraction>;

/** Output of the optional plain-language narrative. Validated by the narrative guard. */
export const ModelNarrative = z.object({
  text: z.string().min(1).max(900),
});
export type ModelNarrative = z.infer<typeof ModelNarrative>;
