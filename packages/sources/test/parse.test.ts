import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cardToRecord,
  mergeRecords,
  parseInactive,
  parseRbiAlertList,
  parseRdap,
  parseSebiCards,
  parseSebiExport,
  parseValidity,
  recordsFromExport,
  SEBI_CATEGORIES,
} from '../src/index.js';

const fx = (p: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url)));
const def = (id: number) => SEBI_CATEGORIES.find((c) => c.intmId === id)!;

describe('SEBI Excel export', () => {
  it('parses the research analyst export with its as-on date', () => {
    const parsed = parseSebiExport(fx('sebi/export-14.xls'));
    expect(parsed.title).toMatch(/^Research Analyst as on/);
    expect(parsed.asOf).toBe('2026-10-03');
    expect(parsed.rows).toHaveLength(25);
    const records = recordsFromExport(parsed, def(14));
    const first = records[0]!;
    expect(first.registrationNumber).toMatch(/^INH\d{9}$/);
    expect(first.category).toBe('RA');
    expect(first.names[0]).toBeTruthy();
    expect(first.sourceUrl).toContain('intmId=14');
    expect(records.every((r) => /^INH\d{9}$/.test(r.registrationNumber))).toBe(true);
  });

  it('keeps exchange and trade name for brokers and merges duplicate rows', () => {
    const records = recordsFromExport(parseSebiExport(fx('sebi/export-30.xls')), def(30));
    expect(records[0]!.exchanges.length).toBeGreaterThan(0);
    const merged = mergeRecords([...records, ...records]);
    expect(merged.length).toBeLessThanOrEqual(records.length);
    expect(merged.every((r) => r.category === 'BROKER')).toBe(true);
  });

  it('parses the (unmodified) mutual fund export', () => {
    const parsed = parseSebiExport(fx('sebi/export-23.xls'));
    expect(parsed.asOf).toBe('2026-10-03');
    expect(parsed.rows.length).toBeGreaterThan(50);
    expect(recordsFromExport(parsed, def(23)).some((r) => /^MF\//.test(r.registrationNumber))).toBe(
      true,
    );
  });

  it('parses validity ranges', () => {
    expect(parseValidity('Feb 16, 2023 - Perpetual')).toEqual({ from: '2023-02-16', to: null });
    expect(parseValidity('Apr 13, 2000 - Apr 12, 2020')).toEqual({
      from: '2000-04-13',
      to: '2020-04-12',
    });
  });
});

describe('SEBI live search HTML', () => {
  it('parses a registration-number hit with its type', () => {
    const { total, cards } = parseSebiCards(fx('sebi/search-found.html').toString('utf8'));
    expect(total).toBe(1);
    const rec = cardToRecord(cards[0]!)!;
    expect(rec).toMatchObject({
      registrationNumber: 'INH000011431',
      category: 'RA',
      validFrom: '2023-02-16',
      validTo: null,
    });
    expect(rec.emails[0]).toMatch(/@/); // entity-encoded email decoded
  });

  it('recognises an empty result', () => {
    expect(parseSebiCards(fx('sebi/search-none.html').toString('utf8'))).toEqual({
      total: 0,
      cards: [],
    });
  });

  it('parses broker segment rows into one category', () => {
    const { cards } = parseSebiCards(fx('sebi/search-broker.html').toString('utf8'));
    const records = cards.map((c) => cardToRecord(c)).filter((r) => r !== null);
    expect(records.length).toBeGreaterThan(1);
    expect(new Set(records.map((r) => r!.category))).toEqual(new Set(['BROKER']));
  });

  it('parses an inactive registration', () => {
    const [inactive] = parseInactive(fx('sebi/inactive-found.html').toString('utf8'));
    expect(inactive).toMatchObject({
      registrationNumber: 'INH000003358',
      status: 'Cancelled',
      categoryLabel: 'Research Analyst',
    });
  });
});

describe('RBI Alert List', () => {
  it('parses names, websites and the update date', () => {
    const parsed = parseRbiAlertList(fx('rbi/alert-list.html').toString('utf8'));
    expect(parsed.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.entries.length).toBeGreaterThan(50);
    expect(parsed.entries.some((e) => e.domains.length > 0)).toBe(true);
    expect(parsed.entries.every((e) => e.name.length > 0)).toBe(true);
  });
});

describe('RDAP', () => {
  it('extracts registration date and registrar', () => {
    const parsed = parseRdap(JSON.parse(fx('rdap/zerodha.com.json').toString('utf8')));
    expect(parsed.registeredOn).toBe('2010-02-17T12:26:39Z');
    expect(parsed.registrar).toBe('Cloudflare, Inc.');
  });
});
