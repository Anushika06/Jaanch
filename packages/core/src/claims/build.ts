import type { Legibility, Span } from '../schemas/common.js';
import type {
  Claim,
  ClaimedCategory,
  GuaranteedReturnsClaim,
  PatternHit,
  PatternKind,
  SpecialAccessClaim,
} from '../schemas/claims.js';
import type {
  Entities,
  OrganizationEntity,
  RegistrationNumberEntity,
} from '../schemas/entities.js';
import type { ModelExtraction } from '../schemas/model-io.js';
import type { TranscriptSegment } from '../schemas/transcript.js';
import type { DeterministicExtraction, LocatedPattern } from '../extract/index.js';
import { analyseUpi, analyseUrl, productContext } from '../extract/index.js';
import { findBusinessNames } from '../extract/orgs.js';
import { findRegistrationNumbers } from '../extract/registration.js';
import { identifierOccurs, locateQuote } from '../text/grounding.js';
import { alnumOnly, clip, foldForMatch } from '../text/normalize.js';

export interface ClaimBuildResult {
  entities: Entities;
  claims: Claim[];
  patterns: PatternHit[];
  /** Model statements that could not be grounded in the transcript and were discarded. */
  discarded: number;
}

const CATEGORY_FROM_MODEL: Record<string, ClaimedCategory | null> = {
  research_analyst: 'RA',
  investment_adviser: 'IA',
  stock_broker: 'BROKER',
  portfolio_manager: 'PMS',
  mutual_fund: 'MF',
  other: 'OTHER',
  unspecified: null,
};

const PATTERN_KIND_FROM_MODEL: Record<string, PatternKind> = {
  urgency: 'URGENCY',
  secrecy: 'SECRECY',
  contact_shift: 'CONTACT_SHIFT',
  remote_access_or_otp: 'REMOTE_ACCESS_OR_OTP',
  pay_to_withdraw: 'PAY_TO_WITHDRAW',
  profit_screenshots: 'PROFIT_SCREENSHOTS',
};

/**
 * Wording that makes a quote an approval claim (English, Hindi, Hinglish). "Registered" is
 * deliberately absent: registration is checked against the register, not read as approval.
 */
const APPROVAL_WORDING = new RegExp(
  'approv|certif|recommend|verified|authori[sz]|endors|backed|sanction|मान्यता|अनुमोद|प्रमाणित|स्वीकृत|मंजूर|मंज़ूर|सत्यापित|manzoor|pramanit|pass kiya|पास किया'.normalize(
    'NFKC',
  ),
  'i',
);

const SIMPLE_PATTERN_KINDS = new Set<string>([
  'URGENCY',
  'SECRECY',
  'CONTACT_SHIFT',
  'REMOTE_ACCESS_OR_OTP',
  'PAY_TO_WITHDRAW',
  'PROFIT_SCREENSHOTS',
  'CRYPTO_PAYMENT',
  'ACCURACY_CLAIM',
]);

function overlaps(a: Span, b: Span): boolean {
  return a.segmentId === b.segmentId && a.start < b.end && b.start < a.end;
}

function quoteLegibility(span: Span, segments: TranscriptSegment[]): Legibility {
  const seg = segments.find((s) => s.id === span.segmentId);
  if (!seg || seg.origin === 'text' || seg.origin === 'url') return 'clear';
  if (seg.origin === 'audio' || seg.quality === 'poor' || seg.quality === 'unreadable')
    return 'uncertain';
  const quoted = alnumOnly(seg.text.slice(span.start, span.end));
  return seg.unclearFragments.some((f) => alnumOnly(f).length > 0 && quoted.includes(alnumOnly(f)))
    ? 'uncertain'
    : 'clear';
}

function textOf(span: Span, segments: TranscriptSegment[]): string {
  const seg = segments.find((s) => s.id === span.segmentId);
  return seg ? seg.text.slice(span.start, span.end) : '';
}

/**
 * Build the claim set from the deterministic extraction and (optionally) the model extraction.
 *
 * Rules that keep the model honest:
 * - every model quote must be located in the transcript, otherwise the item is discarded;
 * - every identifier the model mentions must literally occur in the transcript;
 * - identifiers always come from deterministic extraction (exact strings), never from the model;
 * - a registration number is only tied to a holder name ("explicit" binding) when the grounded
 *   quote contains both, or when they sit on the same/adjacent lines of the transcript.
 */
export function buildClaims(
  segments: TranscriptSegment[],
  det: DeterministicExtraction,
  model: ModelExtraction | null,
): ClaimBuildResult {
  const entities: Entities = structuredClone(det.entities);
  const claims: Claim[] = [];
  const patterns: PatternHit[] = [];
  let discarded = 0;
  const counters: Record<string, number> = {};
  const nextId = (prefix: string) =>
    `${prefix}-${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;

  const ground = (quote: string): Span | null => {
    const s = locateQuote(quote, segments);
    if (!s) discarded++;
    return s;
  };

  // ------------------------------------------------------------------ organisations & people
  if (model) {
    const addOrg = (name: string, role: OrganizationEntity['role'], quote: string) => {
      const span = ground(quote);
      if (!span) return;
      // The organisation name itself must appear in the transcript.
      if (!locateQuote(name, segments) && !identifierOccurs(name, segments)) {
        discarded++;
        return;
      }
      const key = foldForMatch(name);
      const existing = entities.organizations.find((o) => foldForMatch(o.name) === key);
      if (existing) {
        if (role === 'sender') existing.role = 'sender';
        existing.spans.push(span);
        return;
      }
      entities.organizations.push({
        id: nextId('org'),
        name: clip(name, 160),
        role,
        spans: [span],
      });
    };
    if (model.sender) addOrg(model.sender.name, 'sender', model.sender.quote);
    for (const o of model.organizations) addOrg(o.name, o.role, o.quote);

    for (const p of model.persons) {
      const span = ground(p.quote);
      if (!span || !locateQuote(p.name, segments)) continue;
      entities.persons.push({
        id: nextId('person'),
        name: clip(p.name, 120),
        title: p.title ? clip(p.title, 80) : null,
        spans: [span],
      });
    }

    for (const a of model.appInstalls) {
      if (a.appName && locateQuote(a.appName, segments)) {
        const span = ground(a.quote);
        if (span)
          entities.apps.push({ id: nextId('app'), name: clip(a.appName, 80), spans: [span] });
      }
    }
  }

  // Without a model, fall back to conservative business-name detection for the sender.
  const heuristicOrgIds = new Set<string>();
  if (!model) {
    for (const seg of segments) {
      for (const [i, hit] of findBusinessNames(seg.text).entries()) {
        if (entities.organizations.some((o) => foldForMatch(o.name) === foldForMatch(hit.name)))
          continue;
        const id = nextId('org');
        heuristicOrgIds.add(id);
        entities.organizations.push({
          id,
          name: clip(hit.name, 160),
          role:
            i === 0 && !entities.organizations.some((o) => o.role === 'sender')
              ? 'sender'
              : 'mentioned',
          spans: [{ segmentId: seg.id, start: hit.index, end: hit.index + hit.name.length }],
        });
      }
    }
  }

  // ------------------------------------------------------------------ registration claims
  const regByNormalized = new Map(entities.registrationNumbers.map((r) => [r.normalized, r]));
  const usedRegIds = new Set<string>();

  if (model) {
    for (const rc of model.registrationClaims) {
      if (rc.regulator !== 'SEBI' && rc.regulator !== 'AMFI') continue;
      const span = ground(rc.quote);
      if (!span) continue;

      let reg: RegistrationNumberEntity | undefined;
      if (rc.number) {
        // Use the deterministic reading of the number; the model's copy is only a pointer.
        const parsed = findRegistrationNumbers(rc.number)[0];
        reg = parsed ? regByNormalized.get(parsed.normalized) : undefined;
        if (!reg) {
          // Fall back to a number that occurs inside the grounded quote.
          const inQuote = findRegistrationNumbers(textOf(span, segments))[0];
          reg = inQuote ? regByNormalized.get(inQuote.normalized) : undefined;
        }
        if (!reg && !identifierOccurs(rc.number, segments)) {
          discarded++;
          continue;
        }
      }

      const holder =
        rc.holderName && locateQuote(rc.holderName, segments) ? clip(rc.holderName, 160) : null;
      let holderBinding: 'explicit' | 'inferred' | 'none' = 'none';
      if (holder && reg) {
        const quoteText = foldForMatch(textOf(span, segments));
        const holderInQuote = locateQuote(holder, [{ id: 'q', text: quoteText }]) !== null;
        const numberInQuote = reg.spans.some((s) => overlaps(s, span));
        holderBinding =
          holderInQuote && numberInQuote
            ? 'explicit'
            : adjacentLines(holder, reg, segments, det.patterns)
              ? 'explicit'
              : 'inferred';
      } else if (holder) {
        holderBinding = 'inferred';
      }

      if (reg) usedRegIds.add(reg.id);
      claims.push({
        id: nextId('claim'),
        type: 'SEBI_REGISTRATION',
        quote: clip(textOf(span, segments) || rc.quote, 300),
        spans: [span],
        origin: 'model',
        legibility: worst(quoteLegibility(span, segments), reg?.legibility ?? 'clear'),
        category: CATEGORY_FROM_MODEL[rc.category] ?? null,
        regNoId: reg?.id ?? null,
        holderName: holder,
        holderBinding,
      });
    }
  }

  // Registration numbers the model did not attach to a claim still imply one.
  const senderOrg = entities.organizations.find((o) => o.role === 'sender') ?? null;
  for (const reg of entities.registrationNumbers) {
    if (usedRegIds.has(reg.id)) {
      // Mark pattern-confirmed claims.
      const c = claims.find((x) => x.type === 'SEBI_REGISTRATION' && x.regNoId === reg.id);
      if (c && det.patterns.some((p) => p.kind === 'SEBI_REGISTRATION_MENTION'))
        c.origin = 'model+pattern';
      continue;
    }
    const firstSpan = reg.spans[0]!;
    const line = lineContaining(firstSpan, segments);
    const mention = det.patterns.find(
      (p) => p.kind === 'SEBI_REGISTRATION_MENTION' && p.span.segmentId === firstSpan.segmentId,
    );
    let holderName: string | null = null;
    let holderBinding: 'explicit' | 'inferred' | 'none' = 'none';
    if (senderOrg) {
      holderName = senderOrg.name;
      // A heuristically detected name is never strong enough to contradict a record.
      holderBinding =
        !heuristicOrgIds.has(senderOrg.id) &&
        adjacentLines(senderOrg.name, reg, segments, det.patterns)
          ? 'explicit'
          : 'inferred';
    }
    claims.push({
      id: nextId('claim'),
      type: 'SEBI_REGISTRATION',
      quote: clip(line, 300),
      spans: [firstSpan],
      origin: 'pattern',
      legibility: reg.legibility,
      category: (mention?.attrs.category as ClaimedCategory | null | undefined) ?? null,
      regNoId: reg.id,
      holderName,
      holderBinding,
    });
  }

  // "SEBI registered" with no number at all.
  const hasRegistrationClaim = claims.some((c) => c.type === 'SEBI_REGISTRATION');
  if (!hasRegistrationClaim) {
    const mention = det.patterns.find((p) => p.kind === 'SEBI_REGISTRATION_MENTION');
    if (mention) {
      claims.push({
        id: nextId('claim'),
        type: 'SEBI_REGISTRATION',
        quote: clip(mention.quote, 300),
        spans: [mention.span],
        origin: 'pattern',
        legibility: quoteLegibility(mention.span, segments),
        category: (mention.attrs.category as ClaimedCategory | null) ?? null,
        regNoId: null,
        holderName: senderOrg?.name ?? null,
        holderBinding: senderOrg ? 'inferred' : 'none',
      });
    }
  }

  // ------------------------------------------------------------------ identity
  if (senderOrg) {
    const span = senderOrg.spans[0]!;
    claims.push({
      id: nextId('claim'),
      type: 'IDENTITY',
      quote: clip(lineContaining(span, segments), 300),
      spans: [span],
      origin: 'model',
      legibility: quoteLegibility(span, segments),
      orgName: senderOrg.name,
      presentedAs: claims.some((c) => c.type === 'SEBI_REGISTRATION') ? 'intermediary' : 'other',
    });
  }

  // ------------------------------------------------------------------ endorsements
  const endorsementSpans: Span[] = [];
  if (model) {
    for (const e of model.endorsements) {
      if (e.object === 'entity_registration') continue; // that is a registration claim
      const span = ground(e.quote);
      if (!span) continue;
      // A quote without any approval wording ("SEBI Registered Research Analyst") is the model
      // misreading registration wording as an endorsement — not something the message claims.
      const patternBacked = det.patterns.some(
        (p) => p.kind === 'ENDORSEMENT' && overlaps(p.span, span),
      );
      if (!patternBacked && !APPROVAL_WORDING.test(textOf(span, segments))) continue;
      endorsementSpans.push(span);
      claims.push({
        id: nextId('claim'),
        type: 'REGULATOR_ENDORSEMENT',
        quote: clip(textOf(span, segments), 300),
        spans: [span],
        origin: patternBacked ? 'model+pattern' : 'model',
        legibility: quoteLegibility(span, segments),
        authority: e.authority,
        object: e.object,
      });
    }
  }
  for (const p of det.patterns.filter((x) => x.kind === 'ENDORSEMENT')) {
    const object = p.attrs.object as string | null;
    // Only pattern hits that clearly name a product/tip/scheme become endorsement claims;
    // anything else is treated as (checkable) registration wording.
    if (!object || object === 'entity_registration') continue;
    if (endorsementSpans.some((s) => overlaps(s, p.span))) continue;
    claims.push({
      id: nextId('claim'),
      type: 'REGULATOR_ENDORSEMENT',
      quote: clip(p.quote, 300),
      spans: [p.span],
      origin: 'pattern',
      legibility: quoteLegibility(p.span, segments),
      authority: p.attrs.authority as 'SEBI' | 'RBI' | 'NSE' | 'BSE' | 'GOVT',
      object: object as 'product' | 'tip' | 'scheme' | 'app' | 'returns' | 'group',
    });
  }

  // ------------------------------------------------------------------ return promises
  const fullText = segments.map((s) => s.text).join('\n');
  const context = productContext(fullText);
  const returnClaims: GuaranteedReturnsClaim[] = [];
  if (model) {
    for (const r of model.returnPromises) {
      if (r.kind === 'high_unqualified') continue; // high returns without a promise are not a claim we adjudicate
      const span = ground(r.quote);
      if (!span) continue;
      const productCtx =
        r.product === 'fixed_deposit' || r.product === 'bond'
          ? 'deposit'
          : r.product === 'other' || r.product === 'unknown'
            ? context
            : 'market';
      const rate = r.percent !== null ? rateFromQuote(span, segments, r.percent, r.period) : null;
      returnClaims.push({
        id: nextId('claim'),
        type: 'GUARANTEED_RETURNS',
        quote: clip(textOf(span, segments), 300),
        spans: [span],
        origin: det.patterns.some((p) => p.kind === 'GUARANTEE' && overlaps(p.span, span))
          ? 'model+pattern'
          : 'model',
        legibility: quoteLegibility(span, segments),
        kind: r.kind,
        rate,
        productContext: productCtx,
      });
    }
  }
  // Pattern hits: one claim per distinct promise. Lines that state a rate come first, and a hit
  // without a new rate is folded into an existing claim rather than listed again.
  const guaranteeHits = det.patterns
    .filter((x) => x.kind === 'GUARANTEE')
    .map((p) => ({
      p,
      rate: det.patterns.find(
        (x) => x.kind === 'RETURN_RATE' && sameLine(x.span, p.span, segments),
      ),
    }))
    .sort((a, b) => Number(Boolean(b.rate)) - Number(Boolean(a.rate)));
  for (const { p, rate: rateHit } of guaranteeHits) {
    if (returnClaims.some((c) => c.spans.some((s) => sameLine(s, p.span, segments)))) continue;
    const newRate =
      rateHit &&
      !returnClaims.some(
        (c) =>
          c.rate?.percent === Number(rateHit.attrs.percent) &&
          c.rate?.period === rateHit.attrs.period,
      );
    if (returnClaims.length > 0 && !newRate) continue;
    returnClaims.push({
      id: nextId('claim'),
      type: 'GUARANTEED_RETURNS',
      quote: clip(p.quote, 300),
      spans: [p.span],
      origin: 'pattern',
      legibility: quoteLegibility(p.span, segments),
      kind: p.attrs.kind as GuaranteedReturnsClaim['kind'],
      rate: rateHit
        ? {
            percent: Number(rateHit.attrs.percent),
            period: rateHit.attrs.period as GuaranteedReturnsClaim['rate'] extends infer R
              ? R extends { period: infer P }
                ? P
                : never
              : never,
          }
        : null,
      productContext: context,
    });
  }
  // Attach rates found on the same line to claims that lack one.
  for (const c of returnClaims) {
    if (c.rate) continue;
    const rateHit = det.patterns.find(
      (x) => x.kind === 'RETURN_RATE' && c.spans.some((s) => sameLine(x.span, s, segments)),
    );
    if (rateHit)
      c.rate = { percent: Number(rateHit.attrs.percent), period: rateHit.attrs.period as 'day' };
  }
  claims.push(...returnClaims);

  // ------------------------------------------------------------------ payment destinations
  const paymentHandled = new Set<string>();
  if (model) {
    for (const p of model.paymentRequests) {
      const span = ground(p.quote);
      if (!span) continue;
      let upiId: string | null = null;
      if (p.destination && p.method === 'upi') {
        const upi = entities.upiIds.find((u) => u.value === analyseUpi(p.destination!).value);
        upiId = upi?.id ?? null;
      }
      if (!upiId) {
        const upi = entities.upiIds.find((u) => u.spans.some((s) => sameLine(s, span, segments)));
        upiId = upi?.id ?? null;
      }
      const bank = entities.bankAccounts.find((b) =>
        b.spans.some((s) => sameLine(s, span, segments)),
      );
      if (upiId) paymentHandled.add(upiId);
      claims.push({
        id: nextId('claim'),
        type: 'PAYMENT_DESTINATION',
        quote: clip(textOf(span, segments), 300),
        spans: [span],
        origin: 'model',
        legibility: quoteLegibility(span, segments),
        method: p.method,
        upiId,
        bankAccountId: bank?.id ?? null,
      });
    }
  }
  for (const u of entities.upiIds) {
    if (paymentHandled.has(u.id)) continue;
    const span = u.spans[0]!;
    claims.push({
      id: nextId('claim'),
      type: 'PAYMENT_DESTINATION',
      quote: clip(lineContaining(span, segments), 300),
      spans: [span],
      origin: 'pattern',
      legibility: u.legibility,
      method: 'upi',
      upiId: u.id,
      bankAccountId: null,
    });
  }

  // ------------------------------------------------------------------ app installs
  const apkUrls = entities.urls.filter((u) => u.isApkLink);
  const appInstallPatterns = det.patterns.filter((p) => p.kind === 'APP_INSTALL');
  if (model) {
    for (const a of model.appInstalls) {
      const span = ground(a.quote);
      if (!span) continue;
      const url =
        (a.link ? entities.urls.find((u) => u.href === analyseUrl(a.link!)?.href) : undefined) ??
        entities.urls.find((u) => u.spans.some((s) => sameLine(s, span, segments)));
      claims.push({
        id: nextId('claim'),
        type: 'APP_INSTALL',
        quote: clip(textOf(span, segments), 300),
        spans: [span],
        origin: 'model',
        legibility: quoteLegibility(span, segments),
        appName: a.appName && locateQuote(a.appName, segments) ? clip(a.appName, 80) : null,
        urlId: url?.id ?? null,
        sideload: url ? url.isApkLink || url.appStore === null : true,
      });
    }
  }
  if (!claims.some((c) => c.type === 'APP_INSTALL')) {
    const first = apkUrls[0];
    const pattern = appInstallPatterns[0];
    if (first || pattern) {
      const span = first ? first.spans[0]! : pattern!.span;
      const url =
        first ?? entities.urls.find((u) => u.spans.some((s) => sameLine(s, span, segments)));
      claims.push({
        id: nextId('claim'),
        type: 'APP_INSTALL',
        quote: clip(lineContaining(span, segments), 300),
        spans: [span],
        origin: 'pattern',
        legibility: quoteLegibility(span, segments),
        appName: null,
        urlId: url?.id ?? null,
        sideload: url ? url.isApkLink || url.appStore === null : true,
      });
    }
  }

  // ------------------------------------------------------------------ special access offers
  const accessKinds = new Set<string>();
  if (model) {
    for (const s of model.specialAccess) {
      const span = ground(s.quote);
      if (!span || accessKinds.has(s.kind)) continue;
      accessKinds.add(s.kind);
      claims.push({
        id: nextId('claim'),
        type: 'SPECIAL_ACCESS',
        quote: clip(textOf(span, segments), 300),
        spans: [span],
        origin: 'model',
        legibility: quoteLegibility(span, segments),
        kind: s.kind,
      });
    }
  }
  for (const p of det.patterns.filter((x) => x.kind === 'SPECIAL_ACCESS')) {
    const kind = p.attrs.kind as SpecialAccessClaim['kind'];
    if (accessKinds.has(kind)) continue;
    accessKinds.add(kind);
    claims.push({
      id: nextId('claim'),
      type: 'SPECIAL_ACCESS',
      quote: clip(p.quote, 300),
      spans: [p.span],
      origin: 'pattern',
      legibility: quoteLegibility(p.span, segments),
      kind,
    });
  }

  // ------------------------------------------------------------------ behavioural patterns
  const patternKinds = new Map<PatternKind, PatternHit>();
  if (model) {
    for (const p of model.pressure) {
      const kind = PATTERN_KIND_FROM_MODEL[p.kind];
      if (!kind || patternKinds.has(kind)) continue;
      const span = ground(p.quote);
      if (!span) continue;
      patternKinds.set(kind, {
        id: nextId('pattern'),
        kind,
        quote: clip(textOf(span, segments), 240),
        spans: [span],
        origin: 'model',
      });
    }
  }
  for (const p of det.patterns) {
    if (!SIMPLE_PATTERN_KINDS.has(p.kind)) continue;
    const kind = p.kind as PatternKind;
    const existing = patternKinds.get(kind);
    if (existing) {
      if (
        existing.origin === 'model' &&
        existing.spans.some((s) => sameLine(s, p.span, segments))
      ) {
        existing.origin = 'model+pattern';
      }
      continue;
    }
    patternKinds.set(kind, {
      id: nextId('pattern'),
      kind,
      quote: clip(p.quote, 240),
      spans: [p.span],
      origin: 'pattern',
    });
  }
  // Payment to a mobile-number UPI or crypto is recorded as a pattern too.
  const personalUpi = entities.upiIds.find((u) => u.mobileNumberBased);
  if (personalUpi && !patternKinds.has('PERSONAL_ACCOUNT_PAYMENT')) {
    const span = personalUpi.spans[0]!;
    patternKinds.set('PERSONAL_ACCOUNT_PAYMENT', {
      id: nextId('pattern'),
      kind: 'PERSONAL_ACCOUNT_PAYMENT',
      quote: clip(lineContaining(span, segments), 240),
      spans: [span],
      origin: 'pattern',
    });
  }
  patterns.push(...patternKinds.values());

  return { entities, claims, patterns, discarded };
}

// --------------------------------------------------------------------------------------------

function worst(a: Legibility, b: Legibility): Legibility {
  return a === 'uncertain' || b === 'uncertain' ? 'uncertain' : 'clear';
}

function lineBounds(text: string, index: number): [number, number] {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const nl = text.indexOf('\n', index);
  return [start, nl === -1 ? text.length : nl];
}

function lineContaining(span: Span, segments: TranscriptSegment[]): string {
  const seg = segments.find((s) => s.id === span.segmentId);
  if (!seg) return '';
  const [a, b] = lineBounds(seg.text, span.start);
  return seg.text.slice(a, b).trim();
}

function lineNumber(text: string, index: number): number {
  let n = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

function sameLine(a: Span, b: Span, segments: TranscriptSegment[]): boolean {
  if (a.segmentId !== b.segmentId) return false;
  const seg = segments.find((s) => s.id === a.segmentId);
  if (!seg) return false;
  return lineNumber(seg.text, a.start) === lineNumber(seg.text, b.start);
}

/** Holder name and number on the same line or on directly adjacent lines. */
function adjacentLines(
  name: string,
  reg: RegistrationNumberEntity,
  segments: TranscriptSegment[],
  patterns: ReadonlyArray<{ kind: string; span: Span }>,
): boolean {
  for (const regSpan of reg.spans) {
    const seg = segments.find((s) => s.id === regSpan.segmentId);
    if (!seg) continue;
    const lines = seg.text.split('\n');
    const regLine = lineNumber(seg.text, regSpan.start);
    // Lines that state SEBI registration ("SEBI Registered Research Analyst").
    const wordingLines = new Set(
      patterns
        .filter((p) => p.kind === 'SEBI_REGISTRATION_MENTION' && p.span.segmentId === seg.id)
        .map((p) => lineNumber(seg.text, p.span.start)),
    );
    // Every occurrence of the name counts: chat screenshots repeat it in the header.
    for (let i = 0; i < lines.length; i++) {
      if (!locateQuote(name, [{ ...seg, text: lines[i]! }])) continue;
      const [a, b] = i < regLine ? [i, regLine] : [regLine, i];
      if (b - a <= 1) return true;
      // "Name / SEBI Registered Research Analyst / Reg No: INH…" is one self-description: allow up
      // to two short lines between name and number, provided each one states SEBI registration.
      const between = lines.slice(a + 1, b);
      if (
        between.length <= 2 &&
        between.every((line, k) => wordingLines.has(a + 1 + k) && line.length <= 60)
      )
        return true;
    }
  }
  return false;
}

/** Prefer a rate that literally appears in the quote over the model's number. */
function rateFromQuote(
  span: Span,
  segments: TranscriptSegment[],
  percent: number,
  period: GuaranteedReturnsClaim['rate'] extends infer R
    ? R extends { period: infer P }
      ? P
      : never
    : never,
): GuaranteedReturnsClaim['rate'] {
  const text = textOf(span, segments);
  const literal = new RegExp(`(?<![\\d.])${String(percent).replace('.', '\\.')}\\s?%`);
  return literal.test(text) ? { percent, period } : null;
}

export type { LocatedPattern };
