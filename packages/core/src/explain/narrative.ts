import type { Locale } from '../schemas/common.js';
import type { Report } from '../schemas/report.js';
import { dict, t } from './render.js';
import { claimStatement } from './view.js';

/**
 * Facts handed to the (optional) narrator model. They are already-rendered template sentences
 * built from the structured result — the model never sees the original message, so text inside
 * a screenshot cannot steer the explanation.
 */
export interface NarrativeFacts {
  locale: Locale;
  headline: string;
  claims: string[];
  warnings: string[];
  nextSteps: string[];
}

export function narrativeFacts(
  report: Omit<Report, 'summary' | 'graph'> & { summary: Pick<Report['summary'], 'headline'> },
  locale: Locale,
): NarrativeFacts {
  return {
    locale,
    headline: t(locale, report.summary.headline),
    claims: report.claims.map((c) => {
      const r = report.results.find((x) => x.claimId === c.id);
      return `${t(locale, claimStatement(c, report))} → ${dict(locale, `verdict.${r?.verdict ?? 'CANT_CHECK'}`)}: ${r ? t(locale, r.reason) : ''}`;
    }),
    warnings: report.findings
      .filter((f) => f.severity === 'high' || f.severity === 'medium')
      .slice(0, 4)
      .map((f) => t(locale, f.reason)),
    nextSteps: report.nextSteps.slice(0, 3).map((s) => t(locale, s.reason)),
  };
}

/** Deterministic fallback narrative: headline plus the most important supporting sentence. */
export function templateNarrative(facts: NarrativeFacts): string {
  const support = facts.claims.find((c) => c.includes('→')) ?? facts.warnings[0] ?? '';
  const supportText = support.includes(': ') ? support.slice(support.indexOf(': ') + 2) : support;
  return [facts.headline, supportText, facts.nextSteps[0] ?? ''].filter(Boolean).join(' ');
}

const BANNED: Record<Locale, RegExp> = {
  en: /\b(safe|unsafe|scam|scams|scammer|scammers|fraudster|fraudsters|legit|legitimate|genuine|trustworthy|trusted|recommend|recommended|buy|sell|hold|invest now|should invest|definitely|certainly)\b|100\s?%/i,
  hi: /(सुरक्षित|धोखेबाज़|धोखेबाज|फ़्रॉड है|फ्रॉड है|भरोसेमंद|असली है|ख़रीदें|खरीदें|बेचें|निवेश करें|ज़रूर निवेश)/,
};

const NUMBER = /\d[\d,.]*/g;
const IDENTIFIER = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|https?:\/\/\S+|\b[A-Z]{3}\d{9}\b/g;

export interface GuardResult {
  ok: boolean;
  problems: string[];
}

/**
 * Check a model-written narrative before showing it: it may only restate facts. Every number,
 * identifier and link must already appear in the facts; no safety verdicts, labels or
 * investment instructions are allowed.
 */
export function guardNarrative(text: string, facts: NarrativeFacts): GuardResult {
  const problems: string[] = [];
  const corpus = [facts.headline, ...facts.claims, ...facts.warnings, ...facts.nextSteps].join(' ');
  const corpusDigits = corpus.replace(/,/g, '');

  if (text.length < 30 || text.length > 700) problems.push('length');
  if (BANNED[facts.locale].test(text) || BANNED.en.test(text)) problems.push('banned_term');
  for (const n of text.match(NUMBER) ?? []) {
    const clean = n.replace(/,/g, '').replace(/\.$/, '');
    if (clean && !corpusDigits.includes(clean)) problems.push(`unknown_number:${clean}`);
  }
  for (const id of text.match(IDENTIFIER) ?? []) {
    if (!corpus.includes(id.replace(/[.,]$/, ''))) problems.push(`unknown_identifier:${id}`);
  }
  return { ok: problems.length === 0, problems };
}
