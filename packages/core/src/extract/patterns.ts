/**
 * Deterministic phrase detection in English, Hindi (Devanagari) and Hinglish.
 *
 * These patterns are the safety net under the language model: they run on every transcript,
 * keep working when the model is unavailable, and their hits are merged with model output.
 * They are intentionally conservative — precision matters more than recall, because a pattern
 * hit becomes a warning shown to an investor.
 */

export type PatternMatchKind =
  | 'GUARANTEE'
  | 'RETURN_RATE'
  | 'SEBI_REGISTRATION_MENTION'
  | 'ENDORSEMENT'
  | 'SPECIAL_ACCESS'
  | 'APP_INSTALL'
  | 'PAYMENT_REQUEST'
  | 'URGENCY'
  | 'SECRECY'
  | 'CONTACT_SHIFT'
  | 'REMOTE_ACCESS_OR_OTP'
  | 'PAY_TO_WITHDRAW'
  | 'CRYPTO_PAYMENT'
  | 'PROFIT_SCREENSHOTS'
  | 'ACCURACY_CLAIM';

export interface PatternMatch {
  kind: PatternMatchKind;
  index: number;
  length: number;
  /** The line containing the match, clipped — used as the claim quote. */
  quote: string;
  attrs: Record<string, string | number | null>;
}

// Word boundaries that also work for Devanagari (JS \b is ASCII-only).
const L = '(?<![\\p{L}\\p{M}\\p{N}])';
const R = '(?![\\p{L}\\p{M}\\p{N}])';

/**
 * Patterns are normalised exactly like transcripts (NFKC), so Devanagari letters with a nukta
 * (फ़ = फ + ़) match whether the message used the precomposed or the decomposed form.
 */
function re(source: string): RegExp {
  return new RegExp(source.normalize('NFKC'), 'giu');
}

// ---------------------------------------------------------------------------------------------
// Return promises

const GUARANTEE_PATTERNS: Array<{ re: RegExp; kind: string; negatable: boolean }> = [
  { re: re(`${L}(?:guarantee(?:d)?|guaranty)${R}`), kind: 'guaranteed', negatable: true },
  { re: re(`${L}assured${R}`), kind: 'assured', negatable: true },
  {
    re: re(
      `${L}fixed\\s+(?:daily\\s+|weekly\\s+|monthly\\s+)?(?:returns?|profits?|income|payouts?|earnings?)${R}`,
    ),
    kind: 'fixed',
    negatable: true,
  },
  { re: re(`${L}(?:risk[\\s-]?free|zero[\\s-]?risk)${R}`), kind: 'risk_free', negatable: true },
  {
    re: re(`${L}(?:no|without\\s+(?:any\\s+)?)[\\s-]?risk${R}`),
    kind: 'risk_free',
    negatable: false,
  },
  {
    re: re(`${L}(?:no[\\s-]?loss|loss[\\s-]?proof|zero[\\s-]?loss)${R}`),
    kind: 'no_loss',
    negatable: false,
  },
  {
    re: re(`${L}100\\s?%\\s*(?:profit|returns?|sure|safe|guaranteed|accura(?:cy|te)|success)${R}`),
    kind: 'guaranteed',
    negatable: true,
  },
  { re: re(`${L}sure[\\s-]?shot${R}`), kind: 'guaranteed', negatable: true },
  {
    re: re(`${L}(?:double\\s+(?:your|the)\\s+(?:money|investment|capital)|money\\s+double)${R}`),
    kind: 'guaranteed',
    negatable: true,
  },
  { re: re(`${L}capital\\s+(?:protection|protected|safe)${R}`), kind: 'no_loss', negatable: true },
  // Hindi (Devanagari)
  { re: re(`गारंटी(?:ड|शुदा)?`), kind: 'guaranteed', negatable: true },
  {
    re: re(`पक्का\\s*(?:मुनाफा|मुनाफ़ा|रिटर्न|प्रॉफिट|लाभ|फायदा|फ़ायदा)`),
    kind: 'guaranteed',
    negatable: true,
  },
  { re: re(`निश्चित\\s*(?:रिटर्न|लाभ|मुनाफा|मुनाफ़ा|आय|कमाई)`), kind: 'fixed', negatable: true },
  {
    re: re(`बिना\\s*(?:किसी\\s*)?(?:जोखिम|रिस्क|नुकसान|नुक़सान)`),
    kind: 'risk_free',
    negatable: false,
  },
  {
    re: re(`(?:कोई\\s*)?(?:जोखिम|रिस्क|नुकसान|नुक़सान|लॉस)\\s*नहीं`),
    kind: 'no_loss',
    negatable: false,
  },
  { re: re(`(?:पैसा|पैसे|रकम)\\s*(?:डबल|दोगुना|दुगना)`), kind: 'guaranteed', negatable: true },
  // Hinglish
  {
    re: re(`${L}pakk?a\\s+(?:profit|munafa|return|returns|fayda)${R}`),
    kind: 'guaranteed',
    negatable: true,
  },
  {
    re: re(`${L}(?:loss|nuksaan|nuksan|risk)\\s+(?:nahi|nahin|nhi)\\s*(?:hoga|hai|hota)?${R}`),
    kind: 'no_loss',
    negatable: false,
  },
  { re: re(`${L}paisa\\s+double${R}`), kind: 'guaranteed', negatable: true },
];

const NEGATION_BEFORE = re(
  `${L}(?:not|no|never|nor|cannot|can't|cant|isn't|aren't|don't|doesn't|won't|neither|without\\s+any)${R}[^.\\n]{0,24}$`,
);
const NEGATION_AFTER = re(`^[^.\\n]{0,12}${L}(?:नहीं|नही|nahi|nahin|nhi|not)${R}`);

function isNegated(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  const after = text.slice(index + length, index + length + 20);
  NEGATION_BEFORE.lastIndex = 0;
  NEGATION_AFTER.lastIndex = 0;
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after);
}

const PERIOD_WORDS: Array<{ period: string; re: string }> = [
  {
    period: 'day',
    re: 'daily|per\\s*day|a\\s*day|/\\s*day|every\\s*day|each\\s*day|roz|rozana|roj|rojana|daily\\s*basis|प्रतिदिन|रोज़ाना|रोजाना|रोज़|रोज|हर\\s*दिन|दिन',
  },
  {
    period: 'week',
    re: 'weekly|per\\s*week|a\\s*week|/\\s*week|every\\s*week|hafte|hafta|साप्ताहिक|हर\\s*हफ्ते|हफ्ते|हफ़्ते|सप्ताह',
  },
  {
    period: 'month',
    re: 'monthly|per\\s*month|a\\s*month|/\\s*month|every\\s*month|p\\.\\s*m\\.|mahina|mahine|mahiney|मासिक|हर\\s*महीने|महीने|महीना|प्रति\\s*माह',
  },
  {
    period: 'year',
    re: 'yearly|annual(?:ly)?|per\\s*(?:year|annum)|a\\s*year|p\\.\\s*a\\.|/\\s*year|saal|वार्षिक|सालाना|प्रति\\s*वर्ष|साल',
  },
  { period: 'trade', re: 'per\\s*trade|every\\s*trade|each\\s*trade|har\\s*trade' },
];

const PERCENT = '(\\d{1,5}(?:\\.\\d{1,2})?)\\s?(?:%|percent|प्रतिशत|फीसदी|फ़ीसदी)';

function periodPattern(): Array<{ period: string; after: RegExp; before: RegExp }> {
  return PERIOD_WORDS.map((p) => ({
    period: p.period,
    after: re(
      `${PERCENT}\\s*(?:return|returns|profit|profits|income|interest|gain|gains|munafa|मुनाफा|रिटर्न|लाभ)?\\s*(?:${p.re})${R}`,
    ),
    before: re(
      `${L}(?:${p.re})\\s*(?:return|returns|profit|profits|income|munafa|मुनाफा|रिटर्न|लाभ)?\\s*(?:of\\s*|upto\\s*|up\\s*to\\s*)?${PERCENT}`,
    ),
  }));
}
const RATE_PATTERNS = periodPattern();

const MARKET_CONTEXT = re(
  `${L}(?:stocks?|shares?|trading|trade|traders?|intraday|options?|f\\s?&\\s?o|futures|derivatives?|nifty|bank\\s?nifty|sensex|ipo|crypto|bitcoin|usdt|forex|fx|commodit(?:y|ies)|mcx|tips?|calls?|jackpot|multibagger|demat|portfolio|equity|mutual\\s+funds?|शेयर|ट्रेडिंग|स्टॉक|आईपीओ|निफ्टी|क्रिप्टो|फॉरेक्स|टिप्स|कॉल)${R}`,
);
const DEPOSIT_CONTEXT = re(
  `${L}(?:fd|fixed\\s+deposits?|recurring\\s+deposits?|rd|savings?\\s+(?:account|scheme)|ppf|nsc|post\\s+office|senior\\s+citizens?\\s+savings|bank\\s+deposits?|term\\s+deposits?|एफडी|सावधि\\s+जमा)${R}`,
);

export function productContext(text: string): 'market' | 'deposit' | 'unknown' {
  MARKET_CONTEXT.lastIndex = 0;
  DEPOSIT_CONTEXT.lastIndex = 0;
  const market = MARKET_CONTEXT.test(text);
  const deposit = DEPOSIT_CONTEXT.test(text);
  if (market) return 'market';
  if (deposit) return 'deposit';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Registration, endorsement and access claims

const REGISTRATION_MENTION = [
  re(
    `${L}(?:sebi|सेबी)[\\s\\-:]*(?:regd\\.?|registered|registration|reg\\.?|regn\\.?|licen[cs]ed|पंजीकृत|रजिस्टर्ड|रजिस्ट्रेशन|में\\s*पंजीकृत)`,
  ),
  re(`${L}registered\\s+(?:with|under|by)\\s+sebi${R}`),
  re(`${L}sebi\\s+(?:me|mein|se)\\s+(?:registered|regd)${R}`),
  re(
    `${L}(?:sebi|सेबी)\\s*(?:approved|certified|verified|authori[sz]ed|अनुमोदित|प्रमाणित)\\s*(?:research\\s*analyst|investment\\s*advis[eo]r|advis[eo]r|analyst|ra|ia|ria|broker|company|firm|entity|सलाहकार|विश्लेषक)`,
  ),
];

const CATEGORY_WORDS: Array<{ category: string; re: RegExp }> = [
  {
    category: 'RA',
    re: re(`${L}(?:research\\s*analysts?|ra|रिसर्च\\s*एनालिस्ट|अनुसंधान\\s*विश्लेषक)${R}`),
  },
  { category: 'IA', re: re(`${L}(?:investment\\s*advis[eo]rs?|ria|ia|निवेश\\s*सलाहकार)${R}`) },
  { category: 'BROKER', re: re(`${L}(?:stock\\s*brokers?|broker|trading\\s*member|ब्रोकर)${R}`) },
  { category: 'PMS', re: re(`${L}(?:portfolio\\s*manag(?:er|ement)|pms)${R}`) },
  { category: 'MF', re: re(`${L}(?:mutual\\s*fund|amc|म्यूचुअल\\s*फंड)${R}`) },
];

export function categoryNear(text: string): string | null {
  for (const c of CATEGORY_WORDS) {
    c.re.lastIndex = 0;
    if (c.re.test(text)) return c.category;
  }
  return null;
}

const ENDORSEMENT = [
  re(
    `${L}(sebi|nse|bse|rbi|government|govt\\.?|सेबी|आरबीआई|सरकार)[\\s\\-]*(?:approved|certified|recommended|verified|authori[sz]ed|backed|guaranteed|endorsed|अनुमोदित|प्रमाणित|मान्यता\\s*प्राप्त|स्वीकृत)${R}`,
  ),
  re(
    `${L}(?:approved|certified|recommended|verified|authori[sz]ed|backed|guaranteed|endorsed)\\s+by\\s+(?:the\\s+)?(sebi|nse|bse|rbi|government|govt)${R}`,
  ),
  re(`${L}(sebi|nse|bse|rbi)\\s+se\\s+(?:approved|certified|verified)${R}`),
];

const ENDORSED_OBJECTS: Array<{ object: string; re: RegExp }> = [
  {
    object: 'entity_registration',
    re: re(
      `^[\\s\\-:]*(?:research\\s*analyst|investment\\s*advis[eo]r|advis[eo]r|analyst|ra|ia|ria|broker|company|firm|entity|registered|सलाहकार|विश्लेषक|कंपनी)${R}`,
    ),
  },
  {
    object: 'tip',
    re: re(`^[\\s\\-:]*(?:tips?|calls?|stocks?|shares?|recommendations?|टिप्स|कॉल)${R}`),
  },
  {
    object: 'scheme',
    re: re(
      `^[\\s\\-:]*(?:schemes?|plans?|investment|products?|strateg(?:y|ies)|course|योजना|स्कीम)${R}`,
    ),
  },
  { object: 'app', re: re(`^[\\s\\-:]*(?:apps?|application|platform|software|ऐप)${R}`) },
  { object: 'group', re: re(`^[\\s\\-:]*(?:groups?|channel|community|ग्रुप)${R}`) },
  { object: 'returns', re: re(`^[\\s\\-:]*(?:returns?|profits?|income|रिटर्न|मुनाफा)${R}`) },
];

const SPECIAL_ACCESS: Array<{ kind: string; re: RegExp }> = [
  {
    kind: 'institutional_account',
    re: re(
      `${L}(?:institution(?:al)?\\s+(?:trading\\s+)?(?:accounts?|a\\/c|id|quota)|संस्थागत\\s+(?:खाता|अकाउंट))`,
    ),
  },
  { kind: 'fpi_account', re: re(`${L}(?:fpi|fii|qib)\\s+(?:accounts?|a\\/c|quota|trading)${R}`) },
  { kind: 'pre_ipo', re: re(`${L}pre[\\s\\-]?ipo${R}`) },
  {
    kind: 'ipo_allotment',
    re: re(
      `${L}(?:(?:guaranteed|assured|confirmed|100\\s?%|pakka)\\s+(?:ipo\\s+)?allot(?:ment)?|ipo\\s+allot(?:ment)?\\s+(?:guaranteed|assured|confirmed|pakka))${R}`,
    ),
  },
  { kind: 'otc', re: re(`${L}otc\\s+(?:trades?|trading|stocks?|shares?|deals?|market)${R}`) },
  {
    kind: 'block_deal',
    re: re(`${L}(?:block|bulk)\\s+deals?\\s+(?:access|allotment|shares?|stocks?|discount)${R}`),
  },
  {
    kind: 'vip_group',
    re: re(`${L}(?:vip|premium|exclusive)\\s+(?:group|membership|channel|club|plan)${R}`),
  },
];

// ---------------------------------------------------------------------------------------------
// Behavioural patterns

const SIMPLE_PATTERNS: Array<{ kind: PatternMatchKind; re: RegExp }> = [
  {
    kind: 'APP_INSTALL',
    re: re(
      `${L}(?:download|install)\\s+(?:the\\s+|our\\s+|this\\s+|my\\s+)?(?:app|application|apk)${R}`,
    ),
  },
  { kind: 'APP_INSTALL', re: re(`${L}apk\\s*(?:file|download|link)?${R}`) },
  {
    kind: 'APP_INSTALL',
    re: re(
      `${L}not\\s+(?:available\\s+)?on\\s+(?:the\\s+)?(?:play\\s?store|google\\s+play|app\\s+store)${R}`,
    ),
  },
  { kind: 'APP_INSTALL', re: re(`ऐप\\s*(?:डाउनलोड|इंस्टॉल|इंस्टाल)`) },
  {
    kind: 'URGENCY',
    re: re(
      `${L}(?:today\\s+only|only\\s+today|offer\\s+only|limited\\s+(?:seats?|slots?|time|period|offer|members|spots)|last\\s+(?:chance|day|few\\s+(?:seats?|slots?|hours?))|hurry(?:\\s+up)?|act\\s+(?:now|fast)|urgent(?:ly)?|offer\\s+(?:ends|valid\\s+till|closes)|(?:closing|ending)\\s+(?:soon|today|tonight))${R}`,
    ),
  },
  {
    kind: 'URGENCY',
    re: re(
      `${L}(?:within|in)\\s+(?:the\\s+next\\s+)?\\d{1,3}\\s*(?:min(?:ute)?s?|hours?|hrs?)${R}`,
    ),
  },
  {
    kind: 'URGENCY',
    re: re(`${L}(?:aaj\\s+hi|sirf\\s+aaj|jaldi\\s+(?:karo|karein|join)|turant)${R}`),
  },
  {
    kind: 'URGENCY',
    re: re(`(?:आज\\s*ही|सिर्फ\\s*आज|जल्दी\\s*करें|तुरंत|सीमित\\s*(?:सीट|समय)|अंतिम\\s*मौका)`),
  },
  {
    kind: 'SECRECY',
    re: re(
      `${L}(?:don'?t|do\\s+not)\\s+(?:tell|share\\s+(?:this\\s+)?with)\\s+(?:anyone|anybody|others|your\\s+family)${R}`,
    ),
  },
  {
    kind: 'SECRECY',
    re: re(
      `${L}(?:keep\\s+(?:it|this)\\s+(?:secret|confidential|private)|confidential\\s+(?:tip|call|information|info)|insider\\s+(?:information|info|tip|news|trading)|operator\\s+(?:call|stock|info|news))${R}`,
    ),
  },
  {
    kind: 'SECRECY',
    re: re(
      `(?:kisi\\s+ko\\s+(?:mat|na)\\s+(?:batana|batayein|bataye)|किसी\\s*को\\s*(?:मत|न)\\s*(?:बताना|बताएं|बताइए)|गोपनीय)`,
    ),
  },
  {
    kind: 'CONTACT_SHIFT',
    re: re(
      `${L}join\\s+(?:our\\s+|my\\s+|the\\s+)?(?:telegram|whatsapp|vip|free)?\\s*(?:group|channel|community)${R}`,
    ),
  },
  {
    kind: 'CONTACT_SHIFT',
    re: re(
      `${L}(?:message|contact|call|dm|ping|whatsapp)\\s+(?:me|us)?\\s*(?:on|at)\\s+(?:my\\s+|our\\s+)?(?:personal|private)\\s+(?:number|whatsapp|no\\.?)${R}`,
    ),
  },
  {
    kind: 'CONTACT_SHIFT',
    re: re(`(?:ग्रुप\\s*(?:जॉइन|ज्वाइन)|group\\s+join\\s+(?:karo|karein|kare))`),
  },
  {
    kind: 'REMOTE_ACCESS_OR_OTP',
    re: re(`${L}(?:any\\s?desk|team\\s?viewer|quick\\s?support|rust\\s?desk|airdroid)${R}`),
  },
  {
    kind: 'REMOTE_ACCESS_OR_OTP',
    re: re(
      `${L}(?:(?:share|send|tell|give)(?:\\s+me|\\s+us)?\\s+(?:the\\s+|your\\s+)?otp|otp\\s+(?:share|bata|batao|bhejo|send)|screen\\s?shar(?:e|ing))${R}`,
    ),
  },
  { kind: 'REMOTE_ACCESS_OR_OTP', re: re(`ओटीपी\\s*(?:शेयर|बताएं|बताइए|भेजें)`) },
  {
    kind: 'PAY_TO_WITHDRAW',
    re: re(
      `${L}(?:pay|deposit|submit|clear)(?:\\s+the|\\s+a|\\s+your)?\\s+(?:tax|taxes|fee|fees|charges?|commission|gst|tds|penalty|margin)\\s+(?:to|for|before)\\s+(?:withdraw(?:al|ing)?|unlock(?:ing)?|releas(?:e|ing)|transfer(?:ring)?)${R}`,
    ),
  },
  {
    kind: 'PAY_TO_WITHDRAW',
    re: re(
      `${L}(?:withdrawal\\s+(?:fee|fees|charges?|tax)|(?:unlock|release)\\s+(?:your\\s+)?(?:profits?|funds|money|account))${R}`,
    ),
  },
  {
    kind: 'PAY_TO_WITHDRAW',
    re: re(`(?:निकासी\\s*(?:शुल्क|चार्ज)|withdraw\\s+karne\\s+(?:ke\\s+liye|se\\s+pehle))`),
  },
  {
    kind: 'CRYPTO_PAYMENT',
    re: re(
      `${L}(?:usdt|trc[\\s\\-]?20|erc[\\s\\-]?20|bitcoin|btc|crypto\\s+(?:wallet|payment|deposit)|binance\\s+(?:id|pay))${R}`,
    ),
  },
  {
    kind: 'PROFIT_SCREENSHOTS',
    re: re(
      `${L}(?:(?:see|check|look\\s+at)\\s+(?:our\\s+|the\\s+)?(?:members?'?|clients?'?|students?'?)\\s+(?:profits?|earnings?|results?)|profit\\s+screenshots?)${R}`,
    ),
  },
  {
    kind: 'ACCURACY_CLAIM',
    re: re(
      `${L}\\d{2,3}(?:\\.\\d)?\\s?%\\s*(?:accuracy|accurate|success\\s*rate|hit\\s*rate|winning\\s*rate|सटीकता)${R}`,
    ),
  },
  {
    kind: 'ACCURACY_CLAIM',
    re: re(
      `${L}(?:accuracy|success\\s*rate|hit\\s*rate)\\s*(?:of\\s*)?(?:upto\\s*|up\\s*to\\s*)?\\d{2,3}(?:\\.\\d)?\\s?%`,
    ),
  },
  {
    kind: 'PAYMENT_REQUEST',
    re: re(`${L}(?:pay|send|transfer|deposit)\\s+(?:rs\\.?|₹|inr)?\\s?\\d`),
  },
  {
    kind: 'PAYMENT_REQUEST',
    re: re(
      `${L}(?:registration|joining|membership|subscription|activation)\\s+(?:fee|fees|charges?|amount)${R}`,
    ),
  },
  { kind: 'PAYMENT_REQUEST', re: re(`${L}scan\\s+(?:the\\s+|this\\s+)?qr${R}`) },
  {
    kind: 'PAYMENT_REQUEST',
    re: re(`(?:भुगतान\\s*करें|पेमेंट\\s*करें|payment\\s+karo|payment\\s+karein)`),
  },
];

// ---------------------------------------------------------------------------------------------

export function lineAround(text: string, index: number, length: number, max = 220): string {
  const start = Math.max(text.lastIndexOf('\n', index - 1) + 1, 0);
  const endNl = text.indexOf('\n', index + length);
  const end = endNl === -1 ? text.length : endNl;
  let line = text.slice(start, end).trim();
  if (line.length > max) {
    const rel = index - start;
    const from = Math.max(0, rel - Math.floor((max - length) / 2));
    line = line.slice(from, from + max).trim();
  }
  return line;
}

function collect(
  text: string,
  regex: RegExp,
  kind: PatternMatchKind,
  attrs: (m: RegExpMatchArray) => Record<string, string | number | null> | null,
): PatternMatch[] {
  const out: PatternMatch[] = [];
  regex.lastIndex = 0;
  for (const m of text.matchAll(regex)) {
    const a = attrs(m);
    if (a === null) continue;
    out.push({
      kind,
      index: m.index,
      length: m[0].length,
      quote: lineAround(text, m.index, m[0].length),
      attrs: a,
    });
  }
  return out;
}

export function findPatterns(text: string): PatternMatch[] {
  const hits: PatternMatch[] = [];

  for (const g of GUARANTEE_PATTERNS) {
    hits.push(
      ...collect(text, g.re, 'GUARANTEE', (m) =>
        g.negatable && isNegated(text, m.index!, m[0].length) ? null : { kind: g.kind },
      ),
    );
  }

  for (const p of RATE_PATTERNS) {
    for (const regex of [p.after, p.before]) {
      hits.push(
        ...collect(text, regex, 'RETURN_RATE', (m) => {
          const percent = Number(m[1]);
          if (!Number.isFinite(percent) || percent <= 0) return null;
          return { percent, period: p.period };
        }),
      );
    }
  }

  for (const r of REGISTRATION_MENTION) {
    hits.push(
      ...collect(text, r, 'SEBI_REGISTRATION_MENTION', (m) => ({
        category: categoryNear(lineAround(text, m.index!, m[0].length)),
      })),
    );
  }

  for (const r of ENDORSEMENT) {
    hits.push(
      ...collect(text, r, 'ENDORSEMENT', (m) => {
        if (isNegated(text, m.index!, m[0].length)) return null;
        const authorityRaw = (m[1] ?? '').toLowerCase();
        const authority =
          authorityRaw.startsWith('se') || authorityRaw === 'सेबी'
            ? 'SEBI'
            : authorityRaw === 'nse'
              ? 'NSE'
              : authorityRaw === 'bse'
                ? 'BSE'
                : authorityRaw === 'rbi' || authorityRaw === 'आरबीआई'
                  ? 'RBI'
                  : 'GOVT';
        const following = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
        let object: string | null = null;
        for (const o of ENDORSED_OBJECTS) {
          o.re.lastIndex = 0;
          if (o.re.test(following)) {
            object = o.object;
            break;
          }
        }
        return { authority, object };
      }),
    );
  }

  for (const s of SPECIAL_ACCESS) {
    hits.push(...collect(text, s.re, 'SPECIAL_ACCESS', () => ({ kind: s.kind })));
  }

  for (const s of SIMPLE_PATTERNS) {
    hits.push(...collect(text, s.re, s.kind, () => ({})));
  }

  return hits.sort((a, b) => a.index - b.index);
}
