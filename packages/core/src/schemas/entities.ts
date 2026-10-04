import { z } from 'zod';
import { Legibility, Span } from './common.js';

/**
 * Registration-number schemes Jaanch recognises. Format rules live in
 * `extract/registration.ts`; whether a scheme is checkable depends on which registers are loaded.
 */
export const RegistrationScheme = z.enum([
  'SEBI_RA', // Research Analyst
  'SEBI_IA', // Investment Adviser
  'SEBI_BROKER', // Stock Broker
  'SEBI_PMS', // Portfolio Manager
  'SEBI_MB', // Merchant Banker
  'SEBI_RTA', // Registrar to an Issue / Share Transfer Agent
  'SEBI_DT', // Debenture Trustee
  'SEBI_DP', // Depository Participant
  'SEBI_MF', // Mutual Fund
  'SEBI_AIF', // Alternative Investment Fund
  'SEBI_OTHER', // looks like a SEBI number but the category is not recognised
  'AMFI_ARN', // Mutual-fund distributor (registered with AMFI, not SEBI)
]);
export type RegistrationScheme = z.infer<typeof RegistrationScheme>;

const base = {
  id: z.string(),
  spans: z.array(Span).default([]),
};

export const RegistrationNumberEntity = z.object({
  ...base,
  raw: z.string(),
  normalized: z.string(),
  scheme: RegistrationScheme,
  formatValid: z.boolean(),
  legibility: Legibility,
});
export type RegistrationNumberEntity = z.infer<typeof RegistrationNumberEntity>;

export const OrganizationRole = z.enum([
  'sender',
  'mentioned',
  'regulator',
  'exchange',
  'platform',
]);
export type OrganizationRole = z.infer<typeof OrganizationRole>;

export const OrganizationEntity = z.object({
  ...base,
  name: z.string(),
  role: OrganizationRole,
});
export type OrganizationEntity = z.infer<typeof OrganizationEntity>;

export const PersonEntity = z.object({
  ...base,
  name: z.string(),
  title: z.string().nullable().default(null),
});
export type PersonEntity = z.infer<typeof PersonEntity>;

export const PhoneEntity = z.object({
  ...base,
  raw: z.string(),
  e164: z.string().nullable(),
  country: z.string().nullable(),
  isIndian: z.boolean(),
  legibility: Legibility,
});
export type PhoneEntity = z.infer<typeof PhoneEntity>;

export const UpiEntity = z.object({
  ...base,
  raw: z.string(),
  value: z.string(),
  username: z.string(),
  psp: z.string(),
  /** Handle follows SEBI's validated-UPI structure (`<name>.<category>@valid<bank>`). */
  validatedStructure: z.boolean(),
  categorySuffix: z.string().nullable(),
  /** Username is a bare 10-digit mobile number, typical of personal accounts. */
  mobileNumberBased: z.boolean(),
  legibility: Legibility,
});
export type UpiEntity = z.infer<typeof UpiEntity>;

export const UrlEntity = z.object({
  ...base,
  raw: z.string(),
  href: z.string(),
  host: z.string(),
  registrableDomain: z.string().nullable(),
  isShortener: z.boolean(),
  isApkLink: z.boolean(),
  isIpHost: z.boolean(),
  appStore: z.enum(['play', 'apple']).nullable(),
  appStoreId: z.string().nullable(),
  messagingInvite: z.enum(['telegram', 'whatsapp_group', 'whatsapp_chat']).nullable(),
});
export type UrlEntity = z.infer<typeof UrlEntity>;

export const EmailEntity = z.object({
  ...base,
  raw: z.string(),
  address: z.string(),
  domain: z.string(),
  isFreeMail: z.boolean(),
});
export type EmailEntity = z.infer<typeof EmailEntity>;

export const HandleEntity = z.object({
  ...base,
  platform: z.enum(['telegram', 'instagram', 'youtube', 'x']),
  value: z.string(),
});
export type HandleEntity = z.infer<typeof HandleEntity>;

export const BankAccountEntity = z.object({
  ...base,
  /** Only the last four digits are kept; full account numbers are never stored. */
  maskedNumber: z.string(),
  ifsc: z.string().nullable(),
  holderName: z.string().nullable(),
});
export type BankAccountEntity = z.infer<typeof BankAccountEntity>;

export const AppEntity = z.object({
  ...base,
  name: z.string(),
});
export type AppEntity = z.infer<typeof AppEntity>;

export const Entities = z.object({
  registrationNumbers: z.array(RegistrationNumberEntity).default([]),
  organizations: z.array(OrganizationEntity).default([]),
  persons: z.array(PersonEntity).default([]),
  phones: z.array(PhoneEntity).default([]),
  upiIds: z.array(UpiEntity).default([]),
  urls: z.array(UrlEntity).default([]),
  emails: z.array(EmailEntity).default([]),
  handles: z.array(HandleEntity).default([]),
  bankAccounts: z.array(BankAccountEntity).default([]),
  apps: z.array(AppEntity).default([]),
});
export type Entities = z.infer<typeof Entities>;

export function emptyEntities(): Entities {
  return {
    registrationNumbers: [],
    organizations: [],
    persons: [],
    phones: [],
    upiIds: [],
    urls: [],
    emails: [],
    handles: [],
    bankAccounts: [],
    apps: [],
  };
}
