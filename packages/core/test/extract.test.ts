import { describe, expect, it } from 'vitest';
import {
  analyseUpi,
  analyseUrl,
  confusableVariants,
  findBankAccounts,
  findEmails,
  findPatterns,
  findPhones,
  findRegistrationNumbers,
  findUpiIds,
  findHandles,
  findUrls,
  productContext,
} from '../src/index.js';

describe('registration numbers', () => {
  it('finds SEBI numbers in common writings', () => {
    const found = findRegistrationNumbers(
      'SEBI Regd RA: INH000011431. Also IA INA 000 012 345 and broker INZ000031633',
    );
    expect(found.map((f) => [f.normalized, f.scheme, f.formatValid, f.reinterpreted])).toEqual([
      ['INH000011431', 'SEBI_RA', true, false],
      ['INA000012345', 'SEBI_IA', true, false],
      ['INZ000031633', 'SEBI_BROKER', true, false],
    ]);
  });

  it('reads OCR look-alike characters but marks the number as reinterpreted', () => {
    const [f] = findRegistrationNumbers('Reg No INH0000I1431');
    expect(f).toMatchObject({ normalized: 'INH000011431', formatValid: true, reinterpreted: true });
    const [g] = findRegistrationNumbers('Reg No 1NH000011431');
    expect(g).toMatchObject({ normalized: 'INH000011431', reinterpreted: true });
  });

  it('flags malformed numbers instead of dropping them', () => {
    const [f] = findRegistrationNumbers('SEBI RA No. INH0001143112');
    expect(f).toMatchObject({ scheme: 'SEBI_RA', formatValid: false });
  });

  it('does not mistake rupee amounts or country tags for registration numbers', () => {
    expect(findRegistrationNumbers('Invest INR 500000000 today')).toEqual([]);
    expect(findRegistrationNumbers('Call IND 9876543210 now')).toEqual([]);
    expect(findRegistrationNumbers('Registrar INR000003761')).toHaveLength(1);
  });

  it('recognises legacy broker, DP, MF and ARN formats but not banker-to-issue', () => {
    const text =
      'INB011326437, IN-DP-NSDL-123-2015, IN-DP-456-2016, MF/001/93/0, ARN-155, INBI00000012';
    const found = findRegistrationNumbers(text).map((f) => [f.normalized, f.scheme, f.formatValid]);
    expect(found).toContainEqual(['INB011326437', 'SEBI_BROKER', true]);
    expect(found).toContainEqual(['IN-DP-NSDL-123-2015', 'SEBI_DP', true]);
    expect(found).toContainEqual(['IN-DP-456-2016', 'SEBI_DP', true]);
    expect(found).toContainEqual(['MF/001/93/0', 'SEBI_MF', true]);
    expect(found).toContainEqual(['ARN-155', 'AMFI_ARN', true]);
    expect(found.some(([n]) => String(n).startsWith('INBI') || n === 'INB100000012')).toBe(false);
  });

  it('suggests plausible misreadings', () => {
    const v = confusableVariants('INH000011431');
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.startsWith('INH') && x.length === 12)).toBe(true);
  });
});

describe('phones', () => {
  it('normalises Indian and foreign numbers', () => {
    const found = findPhones('WhatsApp +91 98765 43210 or call +44 7911 123456');
    expect(found.map((p) => [p.value.e164, p.value.isIndian])).toEqual([
      ['+919876543210', true],
      ['+447911123456', false],
    ]);
  });
  it('ignores bank account numbers', () => {
    expect(findPhones('A/c No: 9876543210')).toEqual([]);
  });
});

describe('UPI IDs', () => {
  it('finds UPI IDs and analyses validated structure', () => {
    const found = findUpiIds('Pay to 9876543210@ybl or abc.brk@validhdfc');
    expect(found.map((u) => u.value.value)).toEqual(['9876543210@ybl', 'abc.brk@validhdfc']);
    expect(found[0]!.value).toMatchObject({ mobileNumberBased: true, validatedStructure: false });
    expect(found[1]!.value).toMatchObject({ validatedStructure: true, categorySuffix: 'brk' });
  });
  it('does not treat emails as UPI IDs', () => {
    expect(findUpiIds('mail compliance@abcresearch.in for details')).toEqual([]);
  });
  it('needs payment context for unknown handles', () => {
    expect(findUpiIds('contact rahul@unknownbank')).toEqual([]);
    expect(findUpiIds('UPI: rahul@unknownbank')).toHaveLength(1);
  });
  it('analyses handles directly', () => {
    expect(analyseUpi('XYZ.RA@ValidICICI')).toMatchObject({
      value: 'xyz.ra@validicici',
      validatedStructure: true,
      categorySuffix: 'ra',
    });
  });
});

describe('links and emails', () => {
  it('extracts URLs with and without scheme', () => {
    const urls = findUrls(
      'Login at https://zerodha-kite.top/login and www.abcresearch.in. Short: bit.ly/x1',
    );
    expect(urls.map((u) => u.value.registrableDomain)).toEqual([
      'zerodha-kite.top',
      'abcresearch.in',
      'bit.ly',
    ]);
    expect(urls[2]!.value.isShortener).toBe(true);
  });
  it('detects APKs, app stores and messaging invites', () => {
    expect(analyseUrl('https://dl.example.com/app/ZerodhaPro.apk')).toMatchObject({
      isApkLink: true,
    });
    expect(
      analyseUrl('https://play.google.com/store/apps/details?id=com.zerodha.kite3'),
    ).toMatchObject({ appStore: 'play', appStoreId: 'com.zerodha.kite3' });
    expect(analyseUrl('t.me/+AbCdEf')).toMatchObject({ messagingInvite: 'telegram' });
    expect(analyseUrl('https://chat.whatsapp.com/Abc123')).toMatchObject({
      messagingInvite: 'whatsapp_group',
    });
  });
  it('ignores abbreviations that look like domains', () => {
    expect(findUrls('Rs.500 per month, e.g. No.1 advisor')).toEqual([]);
  });
  it('extracts emails and flags free mail', () => {
    const e = findEmails('Write to support@abcresearch.in or abc.research.desk@gmail.com');
    expect(e.map((x) => [x.value.domain, x.value.isFreeMail])).toEqual([
      ['abcresearch.in', false],
      ['gmail.com', true],
    ]);
  });
  it('masks bank account numbers', () => {
    const [b] = findBankAccounts('A/c No: 123456789012 IFSC: HDFC0001234');
    expect(b!.value).toEqual({ maskedNumber: 'XXXX9012', ifsc: 'HDFC0001234' });
  });
});

describe('phrase patterns', () => {
  const kinds = (text: string) => findPatterns(text).map((p) => p.kind);

  it('detects guaranteed-return promises in English, Hindi and Hinglish', () => {
    expect(kinds('Guaranteed 30% monthly returns')).toContain('GUARANTEE');
    expect(kinds('पक्का मुनाफा, कोई नुकसान नहीं')).toContain('GUARANTEE');
    expect(kinds('loss nahi hoga, pakka profit')).toContain('GUARANTEE');
  });

  it('does not treat disclaimers as guarantees', () => {
    expect(
      kinds('Investments are subject to market risks. Returns are not guaranteed.'),
    ).not.toContain('GUARANTEE');
    expect(kinds('There is no guarantee of returns.')).not.toContain('GUARANTEE');
  });

  it('parses return rates with periods', () => {
    const rate = findPatterns('Earn 5% daily profit in F&O').find((p) => p.kind === 'RETURN_RATE');
    expect(rate?.attrs).toEqual({ percent: 5, period: 'day' });
    const hi = findPatterns('रोज़ 3% रिटर्न').find((p) => p.kind === 'RETURN_RATE');
    expect(hi?.attrs).toMatchObject({ percent: 3, period: 'day' });
  });

  it('distinguishes registration wording from product endorsements', () => {
    const reg = findPatterns('SEBI Registered Research Analyst').find(
      (p) => p.kind === 'SEBI_REGISTRATION_MENTION',
    );
    expect(reg?.attrs.category).toBe('RA');
    const tip = findPatterns('SEBI approved tips daily').find((p) => p.kind === 'ENDORSEMENT');
    expect(tip?.attrs).toMatchObject({ authority: 'SEBI', object: 'tip' });
    const adviser = findPatterns('SEBI approved advisor').find((p) => p.kind === 'ENDORSEMENT');
    expect(adviser?.attrs.object).toBe('entity_registration');
  });

  it('detects special-access lures and pressure tactics', () => {
    const k = kinds(
      'Open an institutional trading account for pre-IPO allotment. Offer valid today only! Join our VIP group. Share OTP to activate.',
    );
    expect(k).toEqual(
      expect.arrayContaining(['SPECIAL_ACCESS', 'URGENCY', 'REMOTE_ACCESS_OR_OTP']),
    );
    expect(kinds('आज ही जुड़ें, सीमित सीट')).toContain('URGENCY');
  });

  it('classifies product context', () => {
    expect(productContext('Bank FD at 7.1% p.a.')).toBe('deposit');
    expect(productContext('Intraday options calls')).toBe('market');
    expect(productContext('Hello there')).toBe('unknown');
  });
});

describe('phones inside other identifiers', () => {
  it('does not read the digits of a UPI ID or email as a phone number', () => {
    expect(findPhones('Pay to UPI: 9876501234@ybl')).toEqual([]);
    expect(findPhones('mail 9876501234@gmail.com')).toEqual([]);
    expect(findPhones('Call 9876501234 or pay 9123456780@ybl').map((p) => p.value.e164)).toEqual([
      '+919876501234',
    ]);
  });
});

describe('business names without a model', () => {
  it('finds industry names, legal-form names and support-desk brands', async () => {
    const { findBusinessNames } = await import('../src/extract/orgs.js');
    expect(findBusinessNames('Sharma Investments\nSEBI Registered').map((n) => n.name)).toEqual([
      'Sharma Investments',
    ]);
    expect(
      findBusinessNames('360 ONE Distribution Services Limited\nSEBI RA').map((n) => n.name),
    ).toEqual(['360 ONE Distribution Services Limited']);
    expect(
      findBusinessNames('Zerodha Support: your account is blocked').map((n) => n.name),
    ).toEqual(['Zerodha']);
    expect(findBusinessNames('Join our VIP group today. Pay now.')).toEqual([]);
  });
});

describe('Devanagari nukta forms', () => {
  it('matches promises whether the nukta is precomposed or combined', async () => {
    const { cleanText } = await import('../src/index.js');
    const pre = 'रोज़ 5% पक्का मुनाफ़ा';
    const dec = 'रोज़ 5% पक्का मुनाफ़ा';
    for (const text of [pre, dec]) {
      expect(findPatterns(cleanText(text)).map((p) => p.kind)).toEqual(
        expect.arrayContaining(['GUARANTEE', 'RETURN_RATE']),
      );
    }
  });
});

describe('messaging links and handles', () => {
  it('finds scheme-less Telegram invite links', () => {
    const urls = findUrls('Join our VIP group:\nt.me/+SharmaVIPcalls');
    expect(urls.map((u) => u.raw)).toEqual(['t.me/+SharmaVIPcalls']);
    expect(urls[0]!.value.messagingInvite).toBe('telegram');
    // t.me without a path is not a link.
    expect(findUrls('reply to t.me or call')).toEqual([]);
  });

  it('finds Telegram handles named before or after the platform', () => {
    expect(findHandles('Telegram: @SharmaVIPcalls').map((h) => h.value.value)).toEqual([
      '@sharmavipcalls',
    ]);
    expect(findHandles('Join @SharmaVIPcalls on Telegram').map((h) => h.value.value)).toEqual([
      '@sharmavipcalls',
    ]);
    expect(findHandles('टेलीग्राम पर जुड़ें @SharmaVIPcalls').map((h) => h.value.value)).toEqual([
      '@sharmavipcalls',
    ]);
  });

  it('does not read emails or ordinary words as Telegram handles', () => {
    expect(findHandles('Write to help@telegramtips.in')).toEqual([]);
    expect(findHandles('mortgage rates by @someone_x')).toEqual([]);
  });
});

describe('registration numbers next to chat timestamps', () => {
  const regs = (t: string) => findRegistrationNumbers(t).map((r) => [r.normalized, r.formatValid]);
  it('does not join a number with the timestamp on the next line', () => {
    expect(regs('Reg No: INH000011431\n10:02')).toEqual([['INH000011431', true]]);
  });
  it('stops at the ninth digit when a timestamp follows on the same line', () => {
    expect(regs('Reg No: INH000011431 10:02')).toEqual([['INH000011431', true]]);
    expect(regs('Reg No: INH 000 011 431 10:02')).toEqual([['INH000011431', true]]);
  });
  it('still flags a genuinely malformed number', () => {
    expect(regs('Reg No: INH00001143110')).toEqual([['INH00001143110', false]]);
  });
});
