import type { Locale, Reason, Verdict } from '../schemas/common.js';
import type { Claim } from '../schemas/claims.js';
import type { Evidence } from '../schemas/evidence.js';
import type { Report } from '../schemas/report.js';
import { reason } from '../adjudicate/context.js';
import { RULES, type RuleId } from '../rules/table.js';
import { dict, formatDate, resolveDictRef, t, type RenderOptions } from './render.js';

export interface CitationView {
  title: string;
  reference: string;
  clause: string | null;
  date: string;
  url: string;
}
export interface RuleView {
  id: string;
  statement: string;
  citations: CitationView[];
}
export interface EvidenceView {
  id: string;
  title: string;
  sourceName: string;
  kind: Evidence['kind'];
  fields: Array<{ key: string; label: string; value: string }>;
  url: string | null;
  asOf: string | null;
  retrievedAt: string | null;
  isFixture: boolean;
}
export interface ClaimView {
  id: string;
  type: Claim['type'];
  statement: string;
  quote: string;
  verdict: Verdict;
  verdictLabel: string;
  explanation: string;
  caveats: string[];
  evidence: EvidenceView[];
  rules: RuleView[];
  legibility: Claim['legibility'];
}
export interface BindingView {
  id: string;
  officialName: string;
  registrationNumber: string;
  claimedName: string | null;
  rows: Array<{
    field: string;
    fieldLabel: string;
    inMessage: string | null;
    inRecord: string | null;
    status: string;
    statusLabel: string;
  }>;
}
export interface FindingView {
  id: string;
  severity: string;
  severityLabel: string;
  text: string;
  evidence: EvidenceView[];
  rules: RuleView[];
}
export interface ReportView {
  id: string;
  locale: Locale;
  createdAt: string;
  createdAtLabel: string;
  headline: string;
  narrative: string | null;
  counts: Report['summary']['counts'];
  noClaims: boolean;
  fixtureMode: boolean;
  fixtureBanner: string | null;
  claims: ClaimView[];
  bindings: BindingView[];
  findings: FindingView[];
  unchecked: Array<{ id: string; text: string; cause: string }>;
  nextSteps: Array<{ id: string; text: string; href: string | null; phone: string | null }>;
  sources: Array<{
    id: string;
    name: string;
    status: string;
    mode: string;
    asOf: string | null;
    retrievedAt: string | null;
    stale: boolean;
    isFixture: boolean;
  }>;
  extracted: {
    segments: Array<{ id: string; origin: string; quality: string; text: string }>;
    identifiers: Array<{ kind: string; values: string[] }>;
  };
  graph: Report['graph'];
  labels: Record<string, string>;
}

const FIELD_LABELS_EN: Record<string, string> = {
  name: 'Name',
  trade_name: 'Trade name',
  registration_no: 'Registration no.',
  category: 'Category',
  validity: 'Validity',
  email: 'Email',
  telephone: 'Telephone',
  address: 'Address',
  contact_person: 'Contact person',
  exchange: 'Exchange',
  searched: 'Registers searched',
  as_on: 'Register as of',
  mode: 'Checked via',
  status: 'Status',
  domain: 'Domain',
  registered_on: 'Registered on',
  registrar: 'Registrar',
  website: 'Website',
  matched_on: 'Matched on',
  matched_text: 'Matched text',
};
const FIELD_LABELS_HI: Record<string, string> = {
  name: 'नाम',
  trade_name: 'ट्रेड नाम',
  registration_no: 'रजिस्ट्रेशन नंबर',
  category: 'श्रेणी',
  validity: 'मान्यता अवधि',
  email: 'ईमेल',
  telephone: 'टेलीफ़ोन',
  address: 'पता',
  contact_person: 'संपर्क व्यक्ति',
  exchange: 'एक्सचेंज',
  searched: 'खोजी गई सूचियाँ',
  as_on: 'सूची की तारीख़',
  mode: 'जाँच का तरीक़ा',
  status: 'स्थिति',
  domain: 'डोमेन',
  registered_on: 'रजिस्ट्रेशन तारीख़',
  registrar: 'रजिस्ट्रार',
  website: 'वेबसाइट',
  matched_on: 'किससे मेल खाया',
  matched_text: 'मेल खाता टेक्स्ट',
};

/** The language-neutral statement of what a claim asserts. */
export function claimStatement(claim: Claim, report: Pick<Report, 'entities'>): Reason {
  switch (claim.type) {
    case 'SEBI_REGISTRATION': {
      const reg = claim.regNoId
        ? report.entities.registrationNumbers.find((r) => r.id === claim.regNoId)
        : undefined;
      const category = claim.category ? `@cat.${claim.category}` : '@cat.UNKNOWN';
      if (reg && claim.holderName)
        return reason('CLAIM_REG_NUMBER_NAME', {
          holderName: claim.holderName,
          regNo: reg.normalized,
          category,
        });
      if (reg) return reason('CLAIM_REG_NUMBER', { regNo: reg.normalized, category });
      if (claim.holderName)
        return reason('CLAIM_REG_NAME', { holderName: claim.holderName, category });
      return reason('CLAIM_REG_BARE', { category });
    }
    case 'IDENTITY':
      return reason('CLAIM_IDENTITY', { orgName: claim.orgName });
    case 'REGULATOR_ENDORSEMENT':
      return reason('CLAIM_ENDORSEMENT', {
        authority: `@auth.${claim.authority}`,
        object: `@obj.${claim.object}`,
      });
    case 'GUARANTEED_RETURNS':
      return claim.rate
        ? reason('CLAIM_RETURNS_RATE', {
            kind: `@kind.${claim.kind}`,
            percent: claim.rate.percent,
            period: `@period.${claim.rate.period}`,
          })
        : reason('CLAIM_RETURNS', { kind: `@kind.${claim.kind}` });
    case 'PAYMENT_DESTINATION': {
      const upi = claim.upiId
        ? report.entities.upiIds.find((u) => u.id === claim.upiId)
        : undefined;
      const bank = claim.bankAccountId
        ? report.entities.bankAccounts.find((b) => b.id === claim.bankAccountId)
        : undefined;
      if (upi) return reason('CLAIM_PAYMENT_UPI', { upi: upi.value });
      if (bank) return reason('CLAIM_PAYMENT_BANK', { account: bank.maskedNumber });
      return reason('CLAIM_PAYMENT', { method: `@method.${claim.method}` });
    }
    case 'APP_INSTALL': {
      const url = claim.urlId ? report.entities.urls.find((u) => u.id === claim.urlId) : undefined;
      if (url) return reason('CLAIM_APP_LINK', { domain: url.host });
      if (claim.appName) return reason('CLAIM_APP', { appName: claim.appName });
      return reason('CLAIM_APP_GENERIC');
    }
    case 'SPECIAL_ACCESS':
      return reason('CLAIM_ACCESS', { kind: `@access.${claim.kind}` });
  }
}

export function ruleView(id: string, locale: Locale, opts: RenderOptions = {}): RuleView | null {
  const rule = RULES[id as RuleId];
  if (!rule) return null;
  return {
    id,
    statement: t(locale, reason(`RULE_${id}` as Parameters<typeof reason>[0]), opts),
    citations: rule.citations.map((c) => ({
      title: c.title,
      reference: c.reference,
      clause: c.clause,
      date: c.date,
      url: c.url,
    })),
  };
}

export function evidenceView(e: Evidence, locale: Locale, opts: RenderOptions = {}): EvidenceView {
  const labels = locale === 'hi' ? FIELD_LABELS_HI : FIELD_LABELS_EN;
  const fields =
    e.kind === 'rule'
      ? []
      : Object.entries(e.fields)
          .filter(([, v]) => v !== null && v !== '')
          .map(([key, value]) => ({
            key,
            label: labels[key] ?? key,
            value: resolveDictRef(value!, locale) ?? value!,
          }));
  return {
    id: e.id,
    title: t(locale, e.title, opts),
    sourceName: dict(locale, `src.${e.sourceId}`),
    kind: e.kind,
    fields,
    url: e.url,
    asOf: e.asOf,
    retrievedAt: e.retrievedAt,
    isFixture: e.isFixture,
  };
}

const UI_LABEL_CODES = [
  'UI_REPORT_TITLE',
  'UI_CLAIMS',
  'UI_WARNINGS',
  'UI_UNCHECKED',
  'UI_NEXT',
  'UI_RECOVERY',
  'UI_FULL_REPORT',
  'UI_SOURCES',
  'UI_IDENTIFIERS',
  'UI_DISCLAIMER',
  'UI_ABSENCE_NOTE',
  'UI_OFFICIAL_RECORD_SHOWS',
  'UI_MESSAGE_SAYS',
  'UI_RULE',
  'UI_SOURCE',
] as const;

/** Render a report into display strings for one locale. Used by the web API and summaries. */
export function buildReportView(report: Report, locale: Locale): ReportView {
  const evidenceById = new Map(report.evidence.map((e) => [e.id, e]));
  const ev = (ids: string[]) =>
    ids
      .map((id) => evidenceById.get(id))
      .filter((e): e is Evidence => !!e && e.kind !== 'rule')
      .map((e) => evidenceView(e, locale));
  const rules = (ids: string[]) =>
    ids.map((id) => ruleView(id, locale)).filter((r): r is RuleView => r !== null);

  const claims: ClaimView[] = report.claims.map((c) => {
    const result = report.results.find((r) => r.claimId === c.id);
    return {
      id: c.id,
      type: c.type,
      statement: t(locale, claimStatement(c, report)),
      quote: c.quote,
      verdict: result?.verdict ?? 'CANT_CHECK',
      verdictLabel: dict(locale, `verdict.${result?.verdict ?? 'CANT_CHECK'}`),
      explanation: result ? t(locale, result.reason) : '',
      caveats: (result?.caveats ?? []).map((cv) => t(locale, cv)),
      evidence: ev(result?.evidenceIds ?? []),
      rules: rules(result?.ruleIds ?? []),
      legibility: c.legibility,
    };
  });

  const identifiers: ReportView['extracted']['identifiers'] = [
    { kind: 'registration', values: report.entities.registrationNumbers.map((r) => r.normalized) },
    { kind: 'organization', values: report.entities.organizations.map((o) => o.name) },
    { kind: 'person', values: report.entities.persons.map((p) => p.name) },
    { kind: 'phone', values: report.entities.phones.map((p) => p.e164 ?? p.raw) },
    { kind: 'upi', values: report.entities.upiIds.map((u) => u.value) },
    { kind: 'url', values: report.entities.urls.map((u) => u.href) },
    { kind: 'email', values: report.entities.emails.map((e) => e.address) },
    { kind: 'handle', values: report.entities.handles.map((h) => `${h.platform}: ${h.value}`) },
    {
      kind: 'bank',
      values: report.entities.bankAccounts.map((b) =>
        [b.maskedNumber, b.ifsc].filter(Boolean).join(' · '),
      ),
    },
    { kind: 'app', values: report.entities.apps.map((a) => a.name) },
  ].filter((g) => g.values.length > 0);

  return {
    id: report.id,
    locale,
    createdAt: report.createdAt,
    createdAtLabel: formatDate(report.createdAt, locale, true),
    headline: t(locale, report.summary.headline),
    narrative:
      report.summary.narrative && report.summary.narrative.locale === locale
        ? report.summary.narrative.text
        : null,
    counts: report.summary.counts,
    noClaims: report.summary.noClaims,
    fixtureMode: report.meta.fixtureMode,
    fixtureBanner: report.meta.fixtureMode ? t(locale, 'UI_FIXTURE_BANNER') : null,
    claims,
    bindings: report.bindings.map((b) => ({
      id: b.id,
      officialName: b.officialName,
      registrationNumber: b.registrationNumber,
      claimedName: b.claimedName,
      rows: b.rows.map((r) => ({
        field: r.field,
        fieldLabel: dict(locale, `field.${r.field}`),
        inMessage: r.inMessage,
        inRecord: r.inRecord,
        status: r.status,
        // Emails and websites are compared by domain, so "same" means the same domain.
        statusLabel: dict(
          locale,
          r.status === 'same' && (r.field === 'email' || r.field === 'website')
            ? 'bstatus.same_domain'
            : `bstatus.${r.status}`,
        ),
      })),
    })),
    findings: report.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      severityLabel: dict(locale, `severity.${f.severity}`),
      text: t(locale, f.reason),
      evidence: ev(f.evidenceIds),
      rules: rules(f.ruleIds),
    })),
    unchecked: report.unchecked.map((u) => ({
      id: u.id,
      text: t(locale, u.reason),
      cause: u.cause,
    })),
    nextSteps: report.nextSteps.map((s) => ({
      id: s.id,
      text: t(locale, s.reason),
      href: s.href,
      phone: s.phone,
    })),
    sources: report.sources.map((s) => ({
      id: s.sourceId,
      name: dict(locale, `src.${s.sourceId}`),
      status: s.status,
      mode: s.mode,
      asOf: s.asOf,
      retrievedAt: s.retrievedAt,
      stale: s.stale,
      isFixture: s.isFixture,
    })),
    extracted: {
      segments: report.transcript.map((s) => ({
        id: s.id,
        origin: s.origin,
        quality: s.quality,
        text: s.text,
      })),
      identifiers,
    },
    graph: report.graph,
    labels: Object.fromEntries(UI_LABEL_CODES.map((code) => [code, t(locale, code)])),
  };
}
