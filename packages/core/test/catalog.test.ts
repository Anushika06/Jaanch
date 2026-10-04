import { describe, expect, it } from 'vitest';
import { DICT_EN, DICT_HI, EN, HI, RULE_IDS, RULES, t } from '../src/index.js';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('explanation catalogs', () => {
  it('Hindi has exactly the English keys with the same placeholders', () => {
    expect(Object.keys(HI).sort()).toEqual(Object.keys(EN).sort());
    for (const key of Object.keys(EN) as Array<keyof typeof EN>) {
      expect(placeholders(HI[key]), key).toEqual(placeholders(EN[key]));
    }
  });

  it('dictionaries cover the same keys', () => {
    expect(Object.keys(DICT_HI).sort()).toEqual(Object.keys(DICT_EN).sort());
  });

  it('every rule has a statement and verified primary-source citations', () => {
    for (const id of RULE_IDS) {
      expect(EN).toHaveProperty(`RULE_${id}`);
      const rule = RULES[id];
      expect(rule.citations.length).toBeGreaterThan(0);
      for (const c of rule.citations) {
        expect(c.url).toMatch(/^https:\/\/(www\.sebi\.gov\.in|nsearchives\.nseindia\.com)\//);
        expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('never calls anyone a scammer or anything safe', () => {
    for (const [key, text] of Object.entries(EN)) {
      // UI_ABSENCE_NOTE is the explicit negation: "doesn't mean something is safe".
      if (key.startsWith('RULE_') || key === 'UI_ABSENCE_NOTE') continue;
      expect(text.toLowerCase(), key).not.toMatch(/\bscam(mer)?s?\b|\bis safe\b|\bsafe to\b/);
    }
  });

  it('renders dictionary references, dates and numbers', () => {
    expect(
      t('en', {
        code: 'REG_MATCH',
        params: {
          regNo: 'INH000000001',
          officialName: 'X',
          category: '@cat.RA',
          validTo: '@word.perpetual',
        },
      }),
    ).toContain('Research Analyst');
    expect(
      t('hi', { code: 'F_DOMAIN_NEW', params: { domain: 'a.in', days: 12, date: '2026-09-22' } }),
    ).toContain('12');
    expect(
      t('en', {
        code: 'F_RETURN_RATE_MATH',
        params: { percent: 10, period: '@period.week', annualPercent: 520 },
      }),
    ).toBe('For scale: 10% per week adds up to about 520% in a year, even without compounding.');
  });

  it('sanitises values from messages for WhatsApp', () => {
    const out = t(
      'en',
      { code: 'CLAIM_IDENTITY', params: { orgName: '*FREE* _money_ \u202eevil' } },
      { sanitize: 'whatsapp' },
    );
    expect(out).not.toMatch(/[*_\u202e]/);
  });
});

describe('template parameters', () => {
  it('treats message text starting with "@" as text, never as a dictionary reference', () => {
    const out = t(
      'en',
      { code: 'F_GUARANTEED_RETURNS', params: { quote: '@everyone *100%* sure profit' } },
      { sanitize: 'whatsapp' },
    );
    expect(out).toContain('@everyone');
    expect(out).not.toContain('*');
    const long = t('en', {
      code: 'F_GUARANTEED_RETURNS',
      params: { quote: `@${'x'.repeat(400)}` },
    });
    expect(long.length).toBeLessThan(400);
  });

  it('names the registers searched in the report language', async () => {
    const { registersParam } = await import('../src/adjudicate/records.js');
    const { REGISTRY_CATEGORIES } = await import('../src/index.js');
    const params = (registers: string | null) => ({
      code: 'REG_NOT_IN_REGISTER' as const,
      params: { regNo: 'INH000099991', registers, asOf: '2026-10-03' },
    });
    expect(t('hi', params(registersParam([...REGISTRY_CATEGORIES])))).toContain('सभी 12 सूचियाँ');
    expect(t('en', params(registersParam([...REGISTRY_CATEGORIES])))).toContain(
      'all 12 intermediary registers',
    );
    const some = t('hi', params(registersParam(['RA', 'IA', 'RA'])));
    expect(some).toContain(`${DICT_HI['cat.RA']}, ${DICT_HI['cat.IA']}`);
    expect(some).not.toMatch(/Research Analyst/);
    expect(t('en', params(registersParam([])))).toContain("We searched SEBI's register (updated");
  });
});
