import type { Locale } from '../schemas/common.js';
import type { Report } from '../schemas/report.js';
import { dict, formatDate, t } from './render.js';
import { claimStatement } from './view.js';

export interface SummaryOptions {
  reportUrl: string | null;
  expiresAt: string | null;
}

/**
 * Plain-text evidence summary the person can copy into a complaint (1930 / cybercrime.gov.in /
 * bank). It restates what the message claimed, what the official records showed, the identifiers
 * from the message and the sources consulted — and nothing about the person themselves.
 */
export function renderEvidenceSummary(
  report: Report,
  locale: Locale,
  opts: SummaryOptions,
): string {
  const lines: string[] = [];
  const evidenceById = new Map(report.evidence.map((e) => [e.id, e]));

  lines.push(t(locale, 'UI_SUMMARY_TITLE'));
  lines.push(`${t(locale, 'UI_REPORT_ID')}: ${report.id}`);
  lines.push(`${t(locale, 'UI_CREATED')}: ${formatDate(report.completedAt, locale, true)}`);
  if (opts.reportUrl) {
    lines.push(
      `${t(locale, 'UI_LINK')}: ${opts.reportUrl}${opts.expiresAt ? ` (${t(locale, { code: 'UI_VALID_UNTIL', params: { date: opts.expiresAt } })})` : ''}`,
    );
  }
  if (report.meta.fixtureMode) lines.push(`!! ${t(locale, 'UI_FIXTURE_BANNER')}`);
  lines.push('');

  lines.push(`${t(locale, 'UI_CLAIMS')}:`);
  report.claims.forEach((c, i) => {
    const r = report.results.find((x) => x.claimId === c.id);
    lines.push(`${i + 1}. "${c.quote}"`);
    lines.push(`   → ${t(locale, claimStatement(c, report))}`);
    if (r) {
      lines.push(`   ${dict(locale, `verdict.${r.verdict}`)}: ${t(locale, r.reason)}`);
      for (const id of r.evidenceIds) {
        const e = evidenceById.get(id);
        if (!e) continue;
        const when = e.asOf
          ? ` (${t(locale, { code: 'UI_AS_OF', params: { date: e.asOf } })})`
          : '';
        lines.push(
          `   ${t(locale, 'UI_SOURCE')}: ${t(locale, e.title)}${when}${e.url ? ` — ${e.url}` : ''}`,
        );
      }
    }
  });
  if (report.claims.length === 0) lines.push(`- ${t(locale, 'H_NO_CLAIMS')}`);
  lines.push('');

  const important = report.findings.filter((f) => f.severity !== 'info');
  if (important.length) {
    lines.push(`${t(locale, 'UI_WARNINGS')}:`);
    for (const f of important) lines.push(`- ${t(locale, f.reason)}`);
    lines.push('');
  }

  const ids: string[] = [];
  const e = report.entities;
  if (e.registrationNumbers.length)
    ids.push(`- Reg. no.: ${e.registrationNumbers.map((r) => r.normalized).join(', ')}`);
  if (e.phones.length) ids.push(`- Phone: ${e.phones.map((p) => p.e164 ?? p.raw).join(', ')}`);
  if (e.upiIds.length) ids.push(`- UPI: ${e.upiIds.map((u) => u.value).join(', ')}`);
  if (e.urls.length) ids.push(`- Links: ${e.urls.map((u) => u.href).join(', ')}`);
  if (e.emails.length) ids.push(`- Email: ${e.emails.map((x) => x.address).join(', ')}`);
  if (e.handles.length)
    ids.push(`- Handles: ${e.handles.map((h) => `${h.platform} ${h.value}`).join(', ')}`);
  if (e.bankAccounts.length)
    ids.push(
      `- Bank a/c: ${e.bankAccounts.map((b) => [b.maskedNumber, b.ifsc].filter(Boolean).join(' / ')).join(', ')}`,
    );
  if (ids.length) {
    lines.push(`${t(locale, 'UI_IDENTIFIERS')}:`);
    lines.push(...ids);
    lines.push('');
  }

  lines.push(`${t(locale, 'UI_SOURCES')}:`);
  for (const s of report.sources) {
    const asOf = s.asOf ? ` — ${t(locale, { code: 'UI_AS_OF', params: { date: s.asOf } })}` : '';
    const got = s.retrievedAt
      ? `; ${t(locale, { code: 'UI_RETRIEVED', params: { date: s.retrievedAt } })}`
      : '';
    lines.push(`- ${dict(locale, `src.${s.sourceId}`)} [${s.status}]${asOf}${got}`);
  }
  lines.push('');
  lines.push(t(locale, 'UI_DISCLAIMER'));
  return lines.join('\n');
}
