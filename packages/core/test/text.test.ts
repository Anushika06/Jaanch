import { describe, expect, it } from 'vitest';
import {
  cleanText,
  compareNames,
  foldForMatch,
  identifierOccurs,
  isLookalikeDomain,
  jaroWinkler,
  locateIdentifier,
  locateQuote,
  transliterateDevanagari,
} from '../src/index.js';

describe('normalisation', () => {
  it('converts Indic digits and removes invisible characters', () => {
    expect(cleanText('INH\u200b००००११४३१')).toBe('INH000011431');
    expect(cleanText('a\u00a0\u00a0b')).toBe('a b');
  });
  it('folds Cyrillic look-alikes used in spoofed brand names', () => {
    expect(foldForMatch('Zеrodha')).toBe('zerodha'); // Cyrillic е
  });
});

describe('transliteration', () => {
  it('produces comparable Latin forms of Hindi names', () => {
    expect(transliterateDevanagari('शर्मा')).toBe('sharma');
    expect(transliterateDevanagari('राम')).toBe('ram');
    expect(transliterateDevanagari('संजय')).toBe('sanjay');
  });
});

describe('name comparison', () => {
  it('treats brand and legal names of the same firm as the same', () => {
    expect(compareNames('Zerodha', ['ZERODHA BROKING LIMITED']).result).toBe('same');
    expect(compareNames('Groww', ['GROWW INVEST TECH PRIVATE LIMITED']).result).toBe('same');
    expect(compareNames('Angel One', ['ANGEL ONE LIMITED']).result).toBe('same');
  });
  it('accepts person names without a middle name', () => {
    expect(compareNames('Rahul Sharma', ['RAHUL KUMAR SHARMA']).result).toBe('same');
  });
  it('matches against trade names and proprietor brands', () => {
    expect(compareNames('Dhan', ['MONEYLICIOUS SECURITIES PRIVATE LIMITED', 'DHAN']).result).toBe(
      'same',
    );
  });
  it('reports different entities as different', () => {
    expect(compareNames('Sharma Investments', ['ABC RESEARCH PRIVATE LIMITED']).result).toBe(
      'different',
    );
  });
  it('keeps shared surnames with different industries as only similar', () => {
    expect(compareNames('Sharma Capital', ['SHARMA SECURITIES PVT LTD']).result).toBe('similar');
    expect(compareNames('Sharma', ['RAHUL KUMAR SHARMA']).result).toBe('similar');
  });
  it('is inconclusive for generic names', () => {
    expect(compareNames('Research Desk', ['ABC RESEARCH PRIVATE LIMITED']).result).toBe(
      'inconclusive',
    );
  });
  it('compares Hindi names with English register names', () => {
    expect(compareNames('राहुल शर्मा', ['RAHUL KUMAR SHARMA']).result).toBe('same');
  });
  it('computes Jaro-Winkler', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
  });
});

describe('grounding', () => {
  const segments = [
    {
      id: 's1',
      text: 'Sharma Investments\nSEBI Registered RA: INH 000 011 431\nGuaranteed 30% monthly!',
    },
  ];
  it('locates exact and lightly-different quotes', () => {
    expect(locateQuote('Guaranteed 30% monthly', segments)).not.toBeNull();
    expect(locateQuote('SEBI registered RA INH000011431', segments)).not.toBeNull();
  });
  it('rejects quotes that are not in the transcript', () => {
    expect(locateQuote('Approved by SEBI and RBI with full refund', segments)).toBeNull();
  });
  it('finds identifiers written with separators', () => {
    expect(identifierOccurs('INH000011431', segments)).toBe(true);
    expect(identifierOccurs('INH000099999', segments)).toBe(false);
    const span = locateIdentifier('INH000011431', segments);
    expect(segments[0]!.text.slice(span!.start, span!.end)).toBe('INH 000 011 431');
  });
});

describe('look-alike domains', () => {
  it('detects imitations of an official domain', () => {
    expect(isLookalikeDomain('zerodha-kite.top', 'zerodha.com')).toBe(true);
    expect(isLookalikeDomain('zer0dha.com', 'zerodha.com')).toBe(true);
    expect(isLookalikeDomain('zerodha.co', 'zerodha.com')).toBe(true);
    expect(isLookalikeDomain('abcresearch-support.in', 'abcresearch.in')).toBe(true);
  });
  it('does not flag the official domain or unrelated domains', () => {
    expect(isLookalikeDomain('zerodha.com', 'zerodha.com')).toBe(false);
    expect(isLookalikeDomain('example.org', 'zerodha.com')).toBe(false);
  });
});

describe('redaction', () => {
  it("removes the requester's own number in any common writing", async () => {
    const { redactDigitSequences } = await import('../src/index.js');
    expect(
      redactDigitSequences('Chat: +91 98765 43210 / 9876543210 / 98765-43210', ['919876543210']),
    ).toBe('Chat: [your number] / [your number] / [your number]');
    expect(redactDigitSequences('Call 9123456789', ['919876543210'])).toBe('Call 9123456789');
  });
});
