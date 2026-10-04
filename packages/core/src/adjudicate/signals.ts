import type { Claim, PatternHit } from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import type { Transcript } from '../schemas/transcript.js';
import type { RuleId } from '../rules/table.js';
import type { VerificationOutput } from '../verify/run.js';
import { AdjudicationContext, reason } from './context.js';

const PATTERN_FINDINGS: Record<
  PatternHit['kind'],
  { code: Parameters<typeof reason>[0]; severity: 'high' | 'medium' | 'low'; rules?: RuleId[] }
> = {
  URGENCY: { code: 'F_URGENCY', severity: 'medium' },
  SECRECY: { code: 'F_SECRECY', severity: 'medium' },
  CONTACT_SHIFT: { code: 'F_CONTACT_SHIFT', severity: 'medium', rules: ['CAUTION_VIP_GROUPS'] },
  REMOTE_ACCESS_OR_OTP: { code: 'F_OTP_REMOTE', severity: 'high', rules: ['RA_IA_NEVER_ASK_OTP'] },
  PAY_TO_WITHDRAW: { code: 'F_PAY_TO_WITHDRAW', severity: 'high' },
  PROFIT_SCREENSHOTS: {
    code: 'F_PROFIT_PROOF',
    severity: 'low',
    rules: ['RA_IA_NO_ACCURACY_CLAIMS'],
  },
  CRYPTO_PAYMENT: { code: 'F_CRYPTO_PAYMENT', severity: 'medium' },
  PERSONAL_ACCOUNT_PAYMENT: { code: 'F_UPI_PERSONAL_PATTERN', severity: 'medium' },
  ACCURACY_CLAIM: {
    code: 'F_ACCURACY_CLAIM',
    severity: 'medium',
    rules: ['RA_IA_NO_ACCURACY_CLAIMS'],
  },
};

function daysBetween(from: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(from).getTime()) / 86_400_000);
}

export function adjudicateSignals(
  ctx: AdjudicationContext,
  claims: Claim[],
  patterns: PatternHit[],
  entities: Entities,
  transcript: Transcript,
  v: VerificationOutput,
): void {
  const claimsRegistration = claims.some((c) => c.type === 'SEBI_REGISTRATION');

  // ---------------------------------------------------------------- behavioural patterns
  for (const p of patterns) {
    const spec = PATTERN_FINDINGS[p.kind];
    // A mobile-number UPI is already reported per UPI ID by the payment adjudicator.
    if (
      p.kind === 'PERSONAL_ACCOUNT_PAYMENT' &&
      ctx.findings.some((f) => f.reason.code === 'F_UPI_PERSONAL')
    )
      continue;
    const severity = p.kind === 'ACCURACY_CLAIM' && claimsRegistration ? 'high' : spec.severity;
    ctx.finding(`pattern:${p.kind}`, {
      kind: 'pattern',
      severity,
      reason: reason(spec.code, { quote: p.quote }),
      ...(spec.rules ? { ruleIds: spec.rules } : {}),
    });
  }

  // ---------------------------------------------------------------- links
  for (const u of entities.urls) {
    if (u.isShortener) {
      ctx.finding(`shortener:${u.host}`, {
        kind: 'domain',
        severity: 'medium',
        reason: reason('F_URL_SHORTENER', { domain: u.host }),
        entityIds: [u.id],
      });
    }
    if (u.isIpHost) {
      ctx.finding(`ip-host:${u.host}`, {
        kind: 'domain',
        severity: 'high',
        reason: reason('F_URL_IP_HOST', { host: u.host }),
        entityIds: [u.id],
      });
    }
  }
  for (const [domain, rec] of v.domains) {
    if (rec.status === 'unavailable') {
      ctx.uncheckedItem(`domain-age:${domain}`, {
        reason: reason('U_DOMAIN_AGE', { domain }),
        cause: 'source_unavailable',
        sourceId: 'domain_rdap',
      });
      continue;
    }
    if (rec.status !== 'found' || !rec.registeredOn) continue;
    const days = daysBetween(rec.registeredOn, ctx.now);
    const ev = ctx.addEvidence(`rdap:${domain}`, {
      sourceId: 'domain_rdap',
      kind: 'domain_record',
      title: reason('EV_RDAP', { domain }),
      fields: { domain, registered_on: rec.registeredOn.slice(0, 10), registrar: rec.registrar },
      url: rec.rdapUrl,
      asOf: rec.access.asOf,
      retrievedAt: rec.access.retrievedAt,
      isFixture: rec.access.isFixture,
    });
    if (days >= 0 && days < 180) {
      ctx.finding(`domain-new:${domain}`, {
        kind: 'domain',
        severity: days < 30 ? 'high' : 'medium',
        reason: reason('F_DOMAIN_NEW', { domain, days, date: rec.registeredOn.slice(0, 10) }),
        evidenceIds: [ev],
      });
    }
  }

  // ---------------------------------------------------------------- RBI alert list
  if (v.alert?.status === 'ok') {
    for (const m of v.alert.matches) {
      const ev = ctx.addEvidence(`rbi:${m.entry.name}`, {
        sourceId: 'rbi_alert_list',
        kind: 'list_entry',
        title: reason('EV_RBI_ALERT', { name: m.entry.name }),
        fields: {
          name: m.entry.name,
          website: m.entry.websites.join(', ') || null,
          matched_on: m.matchedOn,
          matched_text: m.query,
        },
        url: m.entry.listUrl,
        asOf: v.alert.access.asOf,
        retrievedAt: v.alert.access.retrievedAt,
        isFixture: v.alert.access.isFixture,
      });
      ctx.finding(`rbi:${m.entry.name}`, {
        kind: 'list_hit',
        severity: 'high',
        reason: reason('F_RBI_ALERT', {
          name: m.entry.name,
          query: m.query,
          asOf: v.alert.access.asOf,
        }),
        evidenceIds: [ev],
      });
    }
  }

  // ---------------------------------------------------------------- contacts
  if (claimsRegistration) {
    for (const p of entities.phones) {
      if (!p.isIndian && p.e164) {
        ctx.finding(`foreign-number:${p.e164}`, {
          kind: 'contact',
          severity: 'medium',
          reason: reason('F_FOREIGN_NUMBER', { phone: p.e164, country: p.country ?? '?' }),
          entityIds: [p.id],
        });
      }
    }
  }

  // ---------------------------------------------------------------- what could not be checked
  for (const run of v.runs) {
    if (run.status === 'unavailable' || run.status === 'error') {
      ctx.uncheckedItem(`source-down:${run.sourceId}`, {
        reason: reason('U_SOURCE_DOWN', { source: `@src.${run.sourceId}` }),
        cause: 'source_unavailable',
        sourceId: run.sourceId,
      });
    }
  }
  if (entities.phones.length) {
    ctx.uncheckedItem('phone-owner', { reason: reason('U_PHONE_OWNER'), cause: 'no_source' });
  }
  if (entities.handles.length || entities.urls.some((u) => u.messagingInvite)) {
    ctx.uncheckedItem('group-links', { reason: reason('U_GROUP_LINKS'), cause: 'no_source' });
  }
  if (entities.urls.some((u) => !u.messagingInvite)) {
    ctx.uncheckedItem('url-content', { reason: reason('U_URL_CONTENT'), cause: 'not_verifiable' });
  }
  if (claims.some((c) => c.type === 'GUARANTEED_RETURNS')) {
    ctx.uncheckedItem('future-returns', {
      reason: reason('U_FUTURE_RETURNS'),
      cause: 'not_verifiable',
    });
  }
  for (const part of transcript.unreadParts) {
    ctx.uncheckedItem(`unread:${part.partIndex}`, {
      reason:
        part.kind === 'audio' &&
        (part.reason === 'unsupported' || part.reason === 'reader_unavailable')
          ? reason('U_AUDIO_UNSUPPORTED')
          : reason('U_UNREADABLE_PART', {
              kind: `@part.${part.kind}`,
              why: `@unread.${part.reason}`,
            }),
      cause: part.reason === 'unreadable' ? 'unclear_input' : 'unsupported_input',
    });
  }
}
