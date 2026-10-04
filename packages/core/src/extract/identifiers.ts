import { findPhoneNumbersInText } from 'libphonenumber-js';
import { parse as parseDomain } from 'tldts';

/** Free consumer mailbox providers; a domain from these says nothing about an organisation. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.in',
  'ymail.com',
  'rediffmail.com',
  'rediff.com',
  'hotmail.com',
  'outlook.com',
  'outlook.in',
  'live.com',
  'live.in',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'zohomail.in',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'tutanota.com',
]);

/** Link shorteners hide the real destination. */
export const URL_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'cutt.ly',
  'rb.gy',
  'is.gd',
  'ow.ly',
  'shorturl.at',
  'tiny.cc',
  'rebrand.ly',
  'bl.ink',
  'shorte.st',
  'buff.ly',
  'surl.li',
  'v.gd',
  'qr.ae',
  'lnkd.in',
  'shrtco.de',
  'urlz.fr',
  'clck.ru',
  'linktr.ee',
  'bitly.com',
  'short.gy',
  'i8.ae',
]);

export interface Located<T> {
  value: T;
  raw: string;
  index: number;
}

// ---------------------------------------------------------------------------------------------
// Phone numbers

export interface PhoneCandidate {
  e164: string | null;
  country: string | null;
  isIndian: boolean;
}

const ACCOUNT_CONTEXT =
  /(a\/c|acc(?:ount)?\.?|acct|खाता|khata)\s*(no\.?|number|num|#|संख्या)?\s*[:-]?\s*$/i;

export function findPhones(text: string): Located<PhoneCandidate>[] {
  const out: Located<PhoneCandidate>[] = [];
  for (const hit of findPhoneNumbersInText(text, 'IN')) {
    const before = text.slice(Math.max(0, hit.startsAt - 24), hit.startsAt);
    if (ACCOUNT_CONTEXT.test(before)) continue; // bank account numbers, not phones
    // Digits that are part of a UPI ID or email ("9876501234@ybl") are not a phone number.
    if (
      text[hit.endsAt] === '@' ||
      text[hit.startsAt - 1] === '@' ||
      /[\w.]$/.test(text.slice(Math.max(0, hit.startsAt - 1), hit.startsAt))
    )
      continue;
    const n = hit.number;
    out.push({
      raw: text.slice(hit.startsAt, hit.endsAt),
      index: hit.startsAt,
      value: {
        e164: n.number ?? null,
        country: n.country ?? null,
        isIndian: n.countryCallingCode === '91',
      },
    });
  }
  return dedupeBy(out, (p) => p.value.e164 ?? p.raw);
}

// ---------------------------------------------------------------------------------------------
// UPI IDs

/** Payment service provider handles in common use. Unknown handles are still accepted in context. */
const KNOWN_UPI_PSPS = new Set([
  'ybl',
  'ibl',
  'axl',
  'paytm',
  'ptyes',
  'ptaxis',
  'pthdfc',
  'ptsbi',
  'okicici',
  'okhdfcbank',
  'oksbi',
  'okaxis',
  'upi',
  'apl',
  'yapl',
  'rapl',
  'icici',
  'hdfcbank',
  'sbi',
  'axisbank',
  'axisb',
  'kotak',
  'kbl',
  'idfcbank',
  'idfcfirst',
  'indus',
  'federal',
  'fbl',
  'freecharge',
  'airtel',
  'jio',
  'pingpay',
  'abfspay',
  'ikwik',
  'mbk',
  'timecosmos',
  'superyes',
  'fam',
  'jupiteraxis',
  'slice',
  'naviaxis',
  'yesbank',
  'yesbankltd',
  'cnrb',
  'barodampay',
  'pnb',
  'unionbank',
  'uboi',
  'allbank',
  'aubank',
  'citi',
  'dbs',
  'equitas',
  'hsbc',
  'idbi',
  'iob',
  'kvb',
  'rbl',
  'sc',
  'tjsb',
  'ubi',
  'utbi',
  'waicici',
  'wahdfcbank',
  'wasbi',
  'waaxis',
  'postbank',
  'cmsidfc',
  'kmbl',
  'dlb',
  'ezeepay',
  'boi',
  'mahb',
  'cbin',
  'psb',
  'csbpay',
]);

const UPI_CANDIDATE =
  /(?<![\w.@-])([a-zA-Z0-9][a-zA-Z0-9._-]{1,255})@([a-zA-Z][a-zA-Z0-9]{1,63})(?![\w@]|\.[a-zA-Z])/g;
const UPI_CONTEXT =
  /\b(upi|vpa|gpay|google ?pay|phone ?pe|phonepe|paytm|bhim|pay|payment|transfer|send|qr)\b|भुगतान|यूपीआई|पेमेंट/i;

export interface UpiCandidate {
  value: string;
  username: string;
  psp: string;
  validatedStructure: boolean;
  categorySuffix: string | null;
  mobileNumberBased: boolean;
}

/**
 * SEBI's validated UPI handles for registered intermediaries follow
 * `<username>.<category>@valid<bank>`. We only check the *structure*; whether a handle really
 * belongs to an intermediary can only be confirmed through SEBI Check.
 */
const VALIDATED_HANDLE = /^([a-z0-9._-]+)\.([a-z]{2,6})@valid[a-z]+$/;

export function analyseUpi(value: string): UpiCandidate {
  const lower = value.toLowerCase();
  const [username = '', psp = ''] = lower.split('@');
  const validated = VALIDATED_HANDLE.exec(lower);
  return {
    value: lower,
    username,
    psp,
    validatedStructure: validated !== null,
    categorySuffix: validated ? validated[2]! : null,
    mobileNumberBased: /^(\+?91)?[6-9]\d{9}(-\d)?$/.test(username),
  };
}

export function findUpiIds(text: string): Located<UpiCandidate>[] {
  const out: Located<UpiCandidate>[] = [];
  const hasContext = UPI_CONTEXT.test(text);
  for (const m of text.matchAll(UPI_CANDIDATE)) {
    const psp = m[2]!.toLowerCase();
    const known = KNOWN_UPI_PSPS.has(psp) || psp.startsWith('valid') || psp.startsWith('ok');
    if (!known && !hasContext) continue;
    out.push({ raw: m[0], index: m.index, value: analyseUpi(m[0]) });
  }
  return dedupeBy(out, (u) => u.value.value);
}

// ---------------------------------------------------------------------------------------------
// Emails

const EMAIL =
  /(?<![\w.-])([a-zA-Z0-9._%+-]{1,64})@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,24})(?![\w-])/g;

export interface EmailCandidate {
  address: string;
  domain: string;
  isFreeMail: boolean;
}

export function findEmails(text: string): Located<EmailCandidate>[] {
  const out: Located<EmailCandidate>[] = [];
  for (const m of text.matchAll(EMAIL)) {
    const domain = m[2]!.toLowerCase();
    if (!parseDomain(domain).domain) continue;
    out.push({
      raw: m[0],
      index: m.index,
      value: { address: m[0].toLowerCase(), domain, isFreeMail: FREE_MAIL_DOMAINS.has(domain) },
    });
  }
  return dedupeBy(out, (e) => e.value.address);
}

// ---------------------------------------------------------------------------------------------
// URLs and bare domains

export interface UrlCandidate {
  href: string;
  host: string;
  registrableDomain: string | null;
  isShortener: boolean;
  isApkLink: boolean;
  isIpHost: boolean;
  appStore: 'play' | 'apple' | null;
  appStoreId: string | null;
  messagingInvite: 'telegram' | 'whatsapp_group' | 'whatsapp_chat' | null;
}

const URL_WITH_SCHEME = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
const BARE_DOMAIN =
  /(?<![@\w./-])((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>"'`)\]}]*)?/gi;

export function analyseUrl(rawInput: string): UrlCandidate | null {
  const raw = rawInput.replace(/[.,;:!?]+$/, '');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parsed = parseDomain(host);
  const isIpHost = parsed.isIp === true;
  if (!isIpHost && (!parsed.domain || parsed.isIcann === false)) return null;
  const registrableDomain = isIpHost ? null : (parsed.domain ?? null);

  let appStore: UrlCandidate['appStore'] = null;
  let appStoreId: string | null = null;
  if (host === 'play.google.com') {
    appStore = 'play';
    appStoreId = url.searchParams.get('id');
  } else if (host === 'apps.apple.com') {
    appStore = 'apple';
    appStoreId = /\/id(\d+)/.exec(url.pathname)?.[1] ?? null;
  }

  let messagingInvite: UrlCandidate['messagingInvite'] = null;
  if (host === 't.me' || host === 'telegram.me' || host === 'telegram.dog')
    messagingInvite = 'telegram';
  else if (host === 'chat.whatsapp.com') messagingInvite = 'whatsapp_group';
  else if (host === 'wa.me' || host === 'api.whatsapp.com') messagingInvite = 'whatsapp_chat';

  return {
    href: url.toString(),
    host,
    registrableDomain,
    isShortener:
      URL_SHORTENERS.has(host) ||
      (registrableDomain !== null && URL_SHORTENERS.has(registrableDomain)),
    isApkLink: /\.apk(\?|#|$)/i.test(url.pathname + url.search) || /\.apk$/i.test(url.pathname),
    isIpHost,
    appStore,
    appStoreId,
    messagingInvite,
  };
}

export function findUrls(text: string): Located<UrlCandidate>[] {
  const out: Located<UrlCandidate>[] = [];
  const covered: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_WITH_SCHEME)) {
    const value = analyseUrl(m[0]);
    if (!value) continue;
    out.push({ raw: m[0].replace(/[.,;:!?]+$/, ''), index: m.index, value });
    covered.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(BARE_DOMAIN)) {
    const start = m.index;
    if (covered.some(([a, b]) => start >= a && start < b)) continue;
    const candidate = m[0];
    // Skip abbreviations and amounts that look like domains ("Rs.500", "No.1", "e.g."), but keep
    // Telegram's one-letter host (t.me/+invite links are common in pitches).
    if (!/[a-z]{2,}\.[a-z]{2,}/i.test(candidate) && !/^t\.me\/./i.test(candidate)) continue;
    const value = analyseUrl(candidate);
    if (!value || value.isIpHost) continue;
    out.push({ raw: candidate.replace(/[.,;:!?]+$/, ''), index: start, value });
  }
  return dedupeBy(out, (u) => u.value.href.replace(/\/$/, ''));
}

// ---------------------------------------------------------------------------------------------
// Social handles

export interface HandleCandidate {
  platform: 'telegram' | 'instagram' | 'youtube' | 'x';
  value: string;
}

// "Telegram: @handle" and "@handle on Telegram". The '@' must not follow a word character, so
// email addresses are never read as handles; "tg" must be a whole word ("mortgage" is not).
const TELEGRAM_HANDLE_AFTER_NAME =
  /(?:telegram|टेलीग्राम|\btg\b)[^\n@]{0,30}(?<![\w.])@([a-zA-Z][a-zA-Z0-9_]{4,31})\b/gi;
const TELEGRAM_HANDLE_BEFORE_NAME =
  /(?<![\w.])@([a-zA-Z][a-zA-Z0-9_]{4,31})\b[^\n@]{0,30}?(?:telegram|टेलीग्राम|\btg\b)/gi;

export function findHandles(text: string): Located<HandleCandidate>[] {
  const out: Located<HandleCandidate>[] = [];
  for (const re of [TELEGRAM_HANDLE_AFTER_NAME, TELEGRAM_HANDLE_BEFORE_NAME]) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].indexOf(`@${m[1]}`);
      out.push({
        raw: `@${m[1]}`,
        index: at,
        value: { platform: 'telegram', value: `@${m[1]!.toLowerCase()}` },
      });
    }
  }
  return dedupeBy(out, (h) => `${h.value.platform}:${h.value.value}`);
}

// ---------------------------------------------------------------------------------------------
// Bank accounts (masked on extraction — full numbers are never kept)

export interface BankAccountCandidate {
  maskedNumber: string;
  ifsc: string | null;
}

const ACCOUNT_NUMBER =
  /(?:a\/c|acc(?:ount)?\.?|acct|खाता)\s*(?:no\.?|number|num|#|संख्या)?\s*[:-]?\s*(\d[\d\s-]{7,20}\d)/gi;
const IFSC = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;

export function findBankAccounts(text: string): Located<BankAccountCandidate>[] {
  const ifscs = [...text.matchAll(IFSC)].map((m) => ({ code: m[1]!, index: m.index }));
  const out: Located<BankAccountCandidate>[] = [];
  for (const m of text.matchAll(ACCOUNT_NUMBER)) {
    const digits = m[1]!.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 18) continue;
    const nearest = ifscs.find((i) => Math.abs(i.index - m.index) < 200);
    out.push({
      raw: `XXXX${digits.slice(-4)}`,
      index: m.index,
      value: { maskedNumber: `XXXX${digits.slice(-4)}`, ifsc: nearest?.code ?? null },
    });
  }
  return out;
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
