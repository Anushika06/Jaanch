import type { Locale, ParamValue, Reason } from '../schemas/common.js';
import { DICT_EN, EN, type ReasonCode } from './catalog/en.js';
import { DICT_HI, HI } from './catalog/hi.js';

const CATALOGS: Record<Locale, Record<ReasonCode, string>> = { en: EN, hi: HI };
const DICTS: Record<Locale, Record<string, string>> = { en: DICT_EN, hi: DICT_HI };

export type Sanitize = 'plain' | 'whatsapp';

export interface RenderOptions {
  sanitize?: Sanitize;
  /** Maximum length of any single value inserted into a template. */
  maxValueLength?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function isReasonCode(code: string): code is ReasonCode {
  return Object.prototype.hasOwnProperty.call(EN, code);
}

export function dict(locale: Locale, key: string): string {
  return DICTS[locale][key] ?? DICT_EN[key] ?? key;
}

const isDictKey = (key: string) => Object.hasOwn(DICT_EN, key);

/**
 * Resolve a dictionary reference: "@key" for one entry, "@@key1,key2" for a list. Anything that
 * is not a reference to an existing entry — such as a quote or a Telegram handle that happens to
 * start with "@" — returns null, so it is treated (and sanitised) as message text.
 */
export function resolveDictRef(value: string, locale: Locale): string | null {
  if (value.startsWith('@@')) {
    const keys = value.slice(2).split(',');
    return keys.every(isDictKey) ? keys.map((k) => dict(locale, k)).join(', ') : null;
  }
  if (value.startsWith('@') && isDictKey(value.slice(1))) return dict(locale, value.slice(1));
  return null;
}

export function formatDate(iso: string, locale: Locale, withTime = false): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
      timeZone: 'Asia/Kolkata',
    }).format(d) + (withTime ? ' IST' : '')
  );
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    maximumFractionDigits: 2,
  }).format(n);
}

/** Make a value taken from an untrusted message safe to show inside our own text. */
export function sanitizeValue(value: string, mode: Sanitize, max: number): string {
  let v = value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (mode === 'whatsapp')
    v = v
      .replace(/[*_~`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function formatParam(
  value: ParamValue | undefined,
  locale: Locale,
  opts: Required<RenderOptions>,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value, locale);
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  const ref = resolveDictRef(value, locale);
  if (ref !== null) return ref;
  if (ISO_DATE.test(value)) return formatDate(value, locale);
  return sanitizeValue(value, opts.sanitize, opts.maxValueLength);
}

/** Remove artefacts left by empty optional values, e.g. "()" or " ," */
function tidy(s: string): string {
  return s
    .replace(/\(\s*[;,]?\s*\)/g, '')
    .replace(/\(\s*;\s*/g, '(')
    .replace(/;\s*\)/g, ')')
    .replace(/\s+([.,;:!?।)])/g, '$1')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

export function t(locale: Locale, r: Reason | ReasonCode, options: RenderOptions = {}): string {
  const reasonObj: Reason = typeof r === 'string' ? { code: r, params: {} } : r;
  const opts: Required<RenderOptions> = {
    sanitize: options.sanitize ?? 'plain',
    maxValueLength: options.maxValueLength ?? 160,
  };
  const template = isReasonCode(reasonObj.code) ? CATALOGS[locale][reasonObj.code] : reasonObj.code;
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) =>
    formatParam(reasonObj.params[key], locale, opts),
  );
  return tidy(filled);
}
