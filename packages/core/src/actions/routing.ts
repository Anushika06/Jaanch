import type { Reason } from '../schemas/common.js';
import type { Claim } from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import type { Binding, ClaimResult, Evidence, Finding, NextStep } from '../schemas/index.js';
import { reason } from '../adjudicate/context.js';

/** Official channels. Every entry was verified against the operator's own site (2026-10-04). */
export const OFFICIAL_LINKS = {
  sebiCheck: 'https://siportal.sebi.gov.in/intermediary/sebi-check',
  sebiIntermediaries: 'https://www.sebi.gov.in/intermediaries.html',
  chakshu: 'https://sancharsaathi.gov.in/sfc/',
  cybercrime: 'https://cybercrime.gov.in',
  scores: 'https://scores.sebi.gov.in',
  npciUpiHelp: 'https://www.upihelp.npci.org.in',
  rbiAlertList: 'https://rbi.org.in/scripts/bs_viewcontent.aspx?Id=4235',
} as const;

export const HELPLINES = {
  cyberFraud: '1930',
  sebiTollFree: '1800 266 7575',
} as const;

interface RoutingInput {
  claims: Claim[];
  results: ClaimResult[];
  findings: Finding[];
  bindings: Binding[];
  evidence: Evidence[];
  entities: Entities;
}

function step(
  id: string,
  r: Reason,
  priority: number,
  extra: { href?: string; phone?: string } = {},
): NextStep {
  return { id, reason: r, priority, href: extra.href ?? null, phone: extra.phone ?? null };
}

/**
 * Deterministic next steps. Steps are about verifying and reporting — never about whether to
 * invest, buy, sell or hold anything.
 */
export function nextSteps(input: RoutingInput): NextStep[] {
  const steps: NextStep[] = [];
  const contradicted = input.results.some((r) => r.verdict === 'CONTRADICTED');
  const highFinding = input.findings.some((f) => f.severity === 'high');
  const hasPayment =
    input.claims.some((c) => c.type === 'PAYMENT_DESTINATION') || input.entities.upiIds.length > 0;
  const hasApp = input.claims.some((c) => c.type === 'APP_INSTALL');
  const regIssue = input.results.some(
    (r) =>
      r.verdict === 'NOT_FOUND' ||
      r.reason.code === 'REG_NO_DETAILS' ||
      r.reason.code === 'REG_REAL_SENDER_UNKNOWN',
  );

  if (contradicted || highFinding) steps.push(step('pause', reason('NS_PAUSE'), 1));

  // Point to the official contact on record — never to the contacts in the message.
  for (const b of input.bindings) {
    const ev = input.evidence.find((e) => e.id === b.recordEvidenceId);
    const phone = ev?.fields.telephone?.split(',')[0]?.trim() ?? null;
    const email = ev?.fields.email?.split(',')[0]?.trim() ?? null;
    const contact = [phone, email].filter(Boolean).join(' / ');
    if (!contact) continue;
    steps.push(
      step(
        `contact-${b.registrationNumber}`,
        reason('NS_CONTACT_OFFICIAL', { officialName: b.officialName, contact }),
        2,
      ),
    );
    break;
  }

  if (hasPayment) {
    steps.push(step('sebi-check', reason('NS_SEBI_CHECK'), 3, { href: OFFICIAL_LINKS.sebiCheck }));
    steps.push(step('upi-name', reason('NS_UPI_NAME'), 4));
  }
  if (hasApp) steps.push(step('official-app', reason('NS_OFFICIAL_APP'), 5));
  if (regIssue)
    steps.push(
      step('verify-sebi', reason('NS_VERIFY_SEBI_SITE'), 6, {
        href: OFFICIAL_LINKS.sebiIntermediaries,
      }),
    );
  if (contradicted || highFinding)
    steps.push(step('chakshu', reason('NS_REPORT_CHAKSHU'), 7, { href: OFFICIAL_LINKS.chakshu }));
  steps.push(step('already-paid', reason('NS_ALREADY_PAID'), 8));
  steps.push(
    step('sebi-helpline', reason('NS_SEBI_HELPLINE'), 9, { phone: HELPLINES.sebiTollFree }),
  );

  return steps.sort((a, b) => a.priority - b.priority);
}

/**
 * "I already paid" routing. Deliberately collects nothing: Jaanch never asks for amounts,
 * account numbers or transaction IDs — it tells the person where to report and what to keep.
 */
export function recoverySteps(input: { identityMatchedOfficialRecord: boolean }): NextStep[] {
  const steps: NextStep[] = [
    step('call-1930', reason('RC_CALL_1930'), 1, { phone: HELPLINES.cyberFraud }),
    step('cybercrime', reason('RC_CYBERCRIME'), 2, { href: OFFICIAL_LINKS.cybercrime }),
    step('bank', reason('RC_BANK'), 3),
    step('upi-complaint', reason('RC_UPI_COMPLAINT'), 4, { href: OFFICIAL_LINKS.npciUpiHelp }),
    step('evidence', reason('RC_EVIDENCE'), 5),
  ];
  if (input.identityMatchedOfficialRecord) {
    steps.push(step('scores', reason('RC_SCORES'), 6, { href: OFFICIAL_LINKS.scores }));
  }
  steps.push(step('recovery-scams', reason('RC_RECOVERY_SCAMS'), 7));
  steps.push(step('summary', reason('RC_SUMMARY'), 8));
  return steps;
}
