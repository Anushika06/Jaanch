/**
 * Conservative business-name detection, used only when the language model is unavailable.
 * Recognises three shapes:
 *  - a capitalised name followed by an industry word ("Sharma Investments", "Alpha Capital");
 *  - a capitalised name ending in a legal form ("360 ONE Distribution Services Limited");
 *  - a brand followed by a support-desk word ("Zerodha Support", "Groww Team") — the usual
 *    shape of impersonation messages; the brand part is returned.
 * Names found this way are only ever "inferred" holders: they can trigger lookups and contact
 * comparisons, never a CONTRADICTED verdict. Names never span lines, hence [ \t] rather than \s.
 */
const SP = '[ \\t]+';
const WORD = "[A-Z0-9][A-Za-z0-9&.'-]*";
const INDUSTRY = `(?:Investments?|Capital|Research|Advisory|Advisors?|Advisers?|Securities|Wealth|Financial(?:${SP}Services)?|Broking|Finserv|Fintech|Markets|Trading|Ventures|Associates|Analytics)`;
const LEGAL = `(?:Pvt\\.?[ \\t]*Ltd\\.?|Private${SP}Limited|Limited|Ltd\\.?|LLP)`;
const DESK = `(?:Support|Team|Desk|Care|Helpdesk|Help${SP}Desk|Customer${SP}Care|Official|Calls)`;

const INDUSTRY_NAME = new RegExp(
  `(?<![A-Za-z])((?:${WORD}${SP}){1,4}${INDUSTRY}(?:${SP}${LEGAL})?)(?![A-Za-z])`,
  'g',
);
const LEGAL_NAME = new RegExp(`(?<![A-Za-z])((?:${WORD}${SP}){1,5}${LEGAL})(?![A-Za-z])`, 'g');
const DESK_NAME = new RegExp(
  `(?<![A-Za-z])(${WORD}(?:${SP}${WORD}){0,2})${SP}${DESK}(?![A-Za-z])`,
  'g',
);

/** Words that start sentences or headings, not firm names. */
const NOT_A_NAME_START =
  /^(SEBI|NSE|BSE|RBI|Our|Your|The|This|Join|Pay|Get|Earn|Daily|Free|Best|Top|Premium|VIP|Registered|Dear|Hello|Hi|Contact|Call|Customer|Investments?|Research)\b/;

export function findBusinessNames(text: string): Array<{ name: string; index: number }> {
  const out: Array<{ name: string; index: number }> = [];
  const add = (name: string, index: number) => {
    const clean = name.trim();
    if (!clean || NOT_A_NAME_START.test(clean) || clean.length > 70 || clean.length < 3) return;
    // Keep the longest form when one detection contains another.
    const existing = out.find(
      (o) =>
        o.name.toLowerCase().includes(clean.toLowerCase()) ||
        clean.toLowerCase().includes(o.name.toLowerCase()),
    );
    if (existing) {
      if (clean.length > existing.name.length) Object.assign(existing, { name: clean, index });
      return;
    }
    out.push({ name: clean, index });
  };
  for (const m of text.matchAll(INDUSTRY_NAME)) add(m[1]!, m.index);
  for (const m of text.matchAll(LEGAL_NAME)) add(m[1]!, m.index);
  for (const m of text.matchAll(DESK_NAME)) add(m[1]!, m.index);
  return out.sort((a, b) => a.index - b.index);
}
