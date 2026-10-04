/**
 * Jaanch rule table.
 *
 * Every rule here was read in the primary source on the date in `verifiedOn`. Rules are cited in
 * reports exactly as listed; the explanation layer renders the rule statement from the i18n
 * catalog (code `RULE_<id>`), never from model output. Re-verify when SEBI notifies changes —
 * e.g. the Common Advertisement Code approved by SEBI's Board on 24 Sep 2026 (PR 59/2026) may
 * replace the advertisement clauses cited below once notified.
 */

export interface Citation {
  title: string;
  reference: string;
  date: string;
  clause: string | null;
  url: string;
}

export interface Rule {
  id: RuleId;
  authority: 'SEBI' | 'NSE/BSE' | 'RBI';
  citations: Citation[];
  verifiedOn: string;
}

const RA_MASTER_CIRCULAR = {
  title: 'SEBI Master Circular for Research Analysts',
  reference: 'HO/38/12/11(1)2026-MIRSD-POD/I/4360/2026',
  date: '2026-02-06',
  url: 'https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770375507051.pdf',
};
const IA_MASTER_CIRCULAR = {
  title: 'SEBI Master Circular for Investment Advisers',
  reference: 'HO/38/12/11(2)2026-MIRSD-POD/I/4300/2026',
  date: '2026-02-06',
  url: 'https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770375291405.pdf',
};
const UPI_CIRCULAR = {
  title:
    'SEBI circular: Standardised, validated and exclusive UPI IDs for payment collection by SEBI registered intermediaries',
  reference: 'SEBI/HO/DEPA-II/DEPA-II_SRG/P/CIR/2025/86',
  date: '2025-06-11',
  url: 'https://www.sebi.gov.in/sebi_data/attachdocs/jun-2025/1749641449497.pdf',
};

export const RULE_IDS = [
  'RA_IA_NO_ASSURED_RETURNS',
  'BROKER_NO_GUARANTEED_RETURN_SCHEMES',
  'ASSURED_RETURN_SCHEMES_PROHIBITED',
  'RA_IA_NO_ACCURACY_CLAIMS',
  'REGISTRATION_DETAILS_IN_COMMUNICATIONS',
  'SEBI_DOES_NOT_APPROVE_SECURITIES',
  'EXCHANGES_SEBI_DO_NOT_ENDORSE',
  'VALIDATED_UPI_FOR_INTERMEDIARIES',
  'RA_IA_NEVER_ASK_OTP',
  'RA_IA_NO_CLIENT_FUNDS',
  'FPI_ROUTE_NOT_FOR_RESIDENTS',
  'CAUTION_SOCIAL_MEDIA_LURES',
  'CAUTION_VIP_GROUPS',
  'CAUTION_FAKE_INSTITUTIONAL_ACCOUNTS',
  'SEBI_EMAIL_DOMAIN',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const RULES: Record<RuleId, Rule> = {
  RA_IA_NO_ASSURED_RETURNS: {
    id: 'RA_IA_NO_ASSURED_RETURNS',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...RA_MASTER_CIRCULAR, clause: 'Para 11.1(c)(x); Annex B (MITC) items (vi)–(vii)' },
      { ...IA_MASTER_CIRCULAR, clause: 'Para 10.1(c)(x); Annex B (MITC)' },
    ],
  },
  BROKER_NO_GUARANTEED_RETURN_SCHEMES: {
    id: 'BROKER_NO_GUARANTEED_RETURN_SCHEMES',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title: 'SEBI (Stock Brokers) Regulations, 2026',
        reference: 'SEBI/LAD-NRO/GN/2026/291',
        date: '2026-01-07',
        clause: 'Regulation 20(a)',
        url: 'https://www.sebi.gov.in/sebi_data/attachdocs/jan-2026/1767852346757.pdf',
      },
    ],
  },
  ASSURED_RETURN_SCHEMES_PROHIBITED: {
    id: 'ASSURED_RETURN_SCHEMES_PROHIBITED',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...RA_MASTER_CIRCULAR, clause: 'Annex B (MITC) item (vi)' },
      {
        title:
          'SEBI press release: Caution to public against fraudulent activities on social media platforms',
        reference: 'PR No. 22/2025',
        date: '2025-04-11',
        clause: null,
        url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/apr-2025/caution-to-public-against-fraudulent-manipulative-activities-on-social-media-platforms-smps-related-to-securities-market_93444.html',
      },
    ],
  },
  RA_IA_NO_ACCURACY_CLAIMS: {
    id: 'RA_IA_NO_ACCURACY_CLAIMS',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...RA_MASTER_CIRCULAR, clause: 'Para 11.1(c)(x) and (xii)' },
      { ...IA_MASTER_CIRCULAR, clause: 'Para 10.1(c)(x)' },
    ],
  },
  REGISTRATION_DETAILS_IN_COMMUNICATIONS: {
    id: 'REGISTRATION_DETAILS_IN_COMMUNICATIONS',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...RA_MASTER_CIRCULAR, clause: 'Para 11.1(b)(i), 11.1(b)(vi), 11.2(i)–(ii)' },
      { ...IA_MASTER_CIRCULAR, clause: 'Para 10.1(b), 10.2' },
    ],
  },
  SEBI_DOES_NOT_APPROVE_SECURITIES: {
    id: 'SEBI_DOES_NOT_APPROVE_SECURITIES',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title:
          'SEBI (Issue of Capital and Disclosure Requirements) Regulations, 2018 (consolidated text)',
        reference: 'Schedule VI, Part A — General Risk statement',
        date: '2026-03-27',
        clause: 'Para (1)(a)(2)(j)',
        url: 'https://www.sebi.gov.in/sebi_data/attachdocs/mar-2026/1774592300989.pdf',
      },
      { ...RA_MASTER_CIRCULAR, clause: 'Para 11.1(b)(viii) and 11.2(iii) — mandatory disclaimer' },
    ],
  },
  EXCHANGES_SEBI_DO_NOT_ENDORSE: {
    id: 'EXCHANGES_SEBI_DO_NOT_ENDORSE',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title: 'SEBI Master Circular for Stock Brokers — Risk Disclosure Document',
        reference: 'SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/90',
        date: '2025-06-17',
        clause:
          'Annexure-10 (Risk Disclosure Document for capital market and derivatives segments)',
        url: 'https://www.sebi.gov.in/sebi_data/attachdocs/jun-2025/1750158789381.pdf',
      },
    ],
  },
  VALIDATED_UPI_FOR_INTERMEDIARIES: {
    id: 'VALIDATED_UPI_FOR_INTERMEDIARIES',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...UPI_CIRCULAR, clause: 'Paras 2, 6.1, 7, 8 and Annexure F (FAQs)' },
      {
        title: 'SEBI press release: Validated UPI handles and SEBI Check now live',
        reference: 'PR No. 64/2025',
        date: '2025-10-01',
        clause: null,
        url: 'https://www.sebi.gov.in/sebi_data/attachdocs/oct-2025/1759322811695.pdf',
      },
    ],
  },
  RA_IA_NEVER_ASK_OTP: {
    id: 'RA_IA_NEVER_ASK_OTP',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...RA_MASTER_CIRCULAR, clause: 'Annex B (MITC) item (xii)' },
      { ...IA_MASTER_CIRCULAR, clause: 'Annex B (MITC) item 15' },
    ],
  },
  RA_IA_NO_CLIENT_FUNDS: {
    id: 'RA_IA_NO_CLIENT_FUNDS',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      { ...IA_MASTER_CIRCULAR, clause: 'Annex B (MITC) item 1' },
      {
        ...RA_MASTER_CIRCULAR,
        clause: 'Investor Charter — "Do not provide funds for investment to the Research Analyst"',
      },
    ],
  },
  FPI_ROUTE_NOT_FOR_RESIDENTS: {
    id: 'FPI_ROUTE_NOT_FOR_RESIDENTS',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title:
          'SEBI press release: Advisory against fraudulent trading schemes claiming to be offered to Indian residents by FPIs',
        reference: 'PR No. 53/2025',
        date: '2025-08-22',
        clause: null,
        url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/aug-2025/advisory-against-investment-in-fraudulent-trading-schemes-claiming-to-be-offered-to-indian-residents-by-fpis_96244.html',
      },
    ],
  },
  CAUTION_SOCIAL_MEDIA_LURES: {
    id: 'CAUTION_SOCIAL_MEDIA_LURES',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title:
          'SEBI press release: Caution to public against fraudulent activities on social media platforms',
        reference: 'PR No. 22/2025',
        date: '2025-04-11',
        clause: null,
        url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/apr-2025/caution-to-public-against-fraudulent-manipulative-activities-on-social-media-platforms-smps-related-to-securities-market_93444.html',
      },
    ],
  },
  CAUTION_VIP_GROUPS: {
    id: 'CAUTION_VIP_GROUPS',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title:
          'SEBI press release: Caution to investors on stock market scams through social media platforms',
        reference: 'PR No. 27/2025',
        date: '2025-05-21',
        clause: null,
        url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/may-2025/caution-to-investors-on-stock-market-scams-through-social-media-platforms_94064.html',
      },
    ],
  },
  CAUTION_FAKE_INSTITUTIONAL_ACCOUNTS: {
    id: 'CAUTION_FAKE_INSTITUTIONAL_ACCOUNTS',
    authority: 'NSE/BSE',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title:
          'Joint press release by stock exchanges: caution against fake FPI/FII sub-accounts and institutional accounts',
        reference: 'Joint release, NSE/BSE',
        date: '2024-08-23',
        clause: null,
        url: 'https://nsearchives.nseindia.com/web/sites/default/files/2024-08/PR_cc_23082024_0.pdf',
      },
      {
        title:
          'SEBI press release: Caution to public against fraudulent activities on social media platforms',
        reference: 'PR No. 22/2025',
        date: '2025-04-11',
        clause: null,
        url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/apr-2025/caution-to-public-against-fraudulent-manipulative-activities-on-social-media-platforms-smps-related-to-securities-market_93444.html',
      },
    ],
  },
  SEBI_EMAIL_DOMAIN: {
    id: 'SEBI_EMAIL_DOMAIN',
    authority: 'SEBI',
    verifiedOn: '2026-10-04',
    citations: [
      {
        title: 'SEBI press release: Caution to the public regarding impersonation of SEBI',
        reference: 'PR No. 60/2025',
        date: '2025-09-05',
        clause: null,
        url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/sep-2025/caution-to-the-public-regarding-impersonation-of-sebi_96449.html',
      },
    ],
  },
};

/**
 * Date after which registered intermediaries had to stop collecting through their old UPI IDs:
 * T + 180 days from the circular dated 11 Jun 2025 (para 7 timeline; Annexure F FAQ).
 */
export const OLD_UPI_DISCONTINUED_FROM = '2025-12-08';

/**
 * Category suffixes of validated UPI handles (Annexure B of the circular). A validated handle has
 * the shape `<username>.<suffix>@valid<bank>`.
 */
export const VALIDATED_UPI_SUFFIXES: Record<string, string> = {
  brk: 'Stock broker',
  bti: 'Banker to an issue',
  dp: 'Depository participant',
  ra: 'Research analyst',
  ia: 'Investment adviser',
  invit: 'InvIT',
  mf: 'Mutual fund',
  pms: 'Portfolio manager',
  sreit: 'SM REIT',
  reit: 'REIT',
};

/** Claimed categories that the validated-UPI mandate covers, with their handle suffix. */
export const CATEGORY_UPI_SUFFIX: Record<string, string> = {
  RA: 'ra',
  IA: 'ia',
  BROKER: 'brk',
  PMS: 'pms',
  MF: 'mf',
};

export function rule(id: RuleId): Rule {
  return RULES[id];
}
