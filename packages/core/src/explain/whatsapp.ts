import type { Locale, Verdict } from '../schemas/common.js';
import type { Report } from '../schemas/report.js';
import { recoverySteps } from '../actions/routing.js';
import { dict, t, type RenderOptions } from './render.js';
import { claimStatement } from './view.js';

/** Twilio rejects bodies over 1600 characters; keep a margin. */
export const WHATSAPP_MAX_CHARS = 1500;

const VERDICT_MARK: Record<Verdict, string> = {
  CONTRADICTED: '❌',
  MATCHES: '✅',
  NOT_FOUND: '🔍',
  CANT_CHECK: '❔',
};

const W: RenderOptions = { sanitize: 'whatsapp', maxValueLength: 90 };

export interface WhatsAppRenderOptions {
  reportUrl: string | null;
  ttlDays: number;
  includePrivacyNote: boolean;
}

function section(title: string, lines: string[]): string {
  return lines.length ? `*${title}*\n${lines.join('\n')}` : '';
}

/**
 * Render a report as one or two WhatsApp messages. The same structured result as the web
 * report underneath; WhatsApp gets the claim verdicts, top warnings and next steps, plus a link
 * to the full evidence. There is never an overall "safe"/"scam" label.
 */
export function renderWhatsApp(
  report: Report,
  locale: Locale,
  opts: WhatsAppRenderOptions,
): string[] {
  const head = `*${t(locale, 'UI_REPORT_TITLE')}* 🔎\n${t(locale, report.summary.headline, W)}`;

  const claimLines = report.claims.map((c) => {
    const r = report.results.find((x) => x.claimId === c.id);
    const verdict = r?.verdict ?? 'CANT_CHECK';
    const statement = t(locale, claimStatement(c, report), W);
    const label = dict(locale, `verdict.${verdict}`);
    const why = r ? t(locale, r.reason, W) : '';
    return `${VERDICT_MARK[verdict]} *${label}* — ${statement}\n   ${why}`;
  });

  const findings = report.findings.filter((f) => f.severity === 'high' || f.severity === 'medium');
  const steps = report.nextSteps.filter((s) => s.id !== 'sebi-helpline' && s.id !== 'already-paid');

  const tail = [
    opts.reportUrl ? `${t(locale, 'UI_FULL_REPORT')}: ${opts.reportUrl}` : '',
    t(locale, 'WA_MENU'),
    opts.includePrivacyNote
      ? t(locale, { code: 'WA_PRIVACY', params: { days: opts.ttlDays } })
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  // Try progressively shorter versions until everything fits in at most two messages.
  for (const limits of [
    { findings: 3, unchecked: 2, steps: 3 },
    { findings: 2, unchecked: 1, steps: 2 },
    { findings: 1, unchecked: 1, steps: 2 },
  ]) {
    const warn = section(
      t(locale, 'UI_WARNINGS'),
      findings.slice(0, limits.findings).map((f) => `⚠️ ${t(locale, f.reason, W)}`),
    );
    const unchecked = section(
      t(locale, 'UI_UNCHECKED'),
      report.unchecked.slice(0, limits.unchecked).map((u) => `• ${t(locale, u.reason, W)}`),
    );
    const next = section(
      t(locale, 'UI_NEXT'),
      steps
        .slice(0, limits.steps)
        .map((s, i) => `${i + 1}. ${t(locale, s.reason, W)}${s.href ? ` ${s.href}` : ''}`),
    );
    const claims = report.summary.noClaims
      ? t(locale, 'WA_NOTHING_TO_CHECK')
      : section(t(locale, 'UI_CLAIMS'), claimLines);
    const fixture = report.meta.fixtureMode ? `⚠️ ${t(locale, 'UI_FIXTURE_BANNER')}` : '';

    const first = [fixture, head, claims].filter(Boolean).join('\n\n');
    const second = [warn, unchecked, next, tail].filter(Boolean).join('\n\n');
    const single = `${first}\n\n${second}`;
    if (single.length <= WHATSAPP_MAX_CHARS) return [single];
    if (first.length <= WHATSAPP_MAX_CHARS && second.length <= WHATSAPP_MAX_CHARS)
      return [first, second];
  }

  // Very long reports: claims one per line without explanations, then the rest.
  const compactClaims = report.claims
    .map((c) => {
      const verdict = report.results.find((x) => x.claimId === c.id)?.verdict ?? 'CANT_CHECK';
      return `${VERDICT_MARK[verdict]} ${dict(locale, `verdict.${verdict}`)} — ${t(locale, claimStatement(c, report), W)}`;
    })
    .slice(0, 8);
  const first = clipMessage([head, section(t(locale, 'UI_CLAIMS'), compactClaims)].join('\n\n'));
  const second = clipMessage(
    [
      section(
        t(locale, 'UI_NEXT'),
        steps.slice(0, 2).map((s, i) => `${i + 1}. ${t(locale, s.reason, W)}`),
      ),
      tail,
    ].join('\n\n'),
  );
  return [first, second];
}

function clipMessage(s: string): string {
  return s.length <= WHATSAPP_MAX_CHARS ? s : `${s.slice(0, WHATSAPP_MAX_CHARS - 1)}…`;
}

/** "I already paid" over WhatsApp: deterministic steps, nothing collected. */
export function renderWhatsAppRecovery(
  report: Report | null,
  locale: Locale,
  opts: { reportUrl: string | null; recoveryUrl: string | null },
): string[] {
  if (!report) return [t(locale, 'WA_PAID_NO_REPORT')];
  const identityMatched = report.results.some((r) => r.reason.code === 'ID_CONTACTS_MATCH');
  const steps = recoverySteps({ identityMatchedOfficialRecord: identityMatched });
  const lines = steps.map(
    (s, i) => `${i + 1}. ${t(locale, s.reason, W)}${s.href ? ` ${s.href}` : ''}`,
  );
  const body = [
    `*${t(locale, 'UI_RECOVERY')}*`,
    lines.join('\n'),
    opts.recoveryUrl ? `${t(locale, 'UI_SUMMARY_TITLE')}: ${opts.recoveryUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [clipMessage(body)];
}
