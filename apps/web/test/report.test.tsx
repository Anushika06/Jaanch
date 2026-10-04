import type { ReportView } from '@jaanch/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Composer } from '../src/components/Composer';
import { Report } from '../src/components/Report';
import { AppContext } from '../src/context';

afterEach(() => cleanup());

const VIEW: ReportView = {
  id: 'JAAAAAAAAAAAAAAAAAAAAAA',
  locale: 'en',
  createdAt: '2026-10-04T08:00:00Z',
  createdAtLabel: '4 Oct 2026',
  headline: "The registration number is real. It just isn't theirs.",
  narrative: null,
  counts: { CONTRADICTED: 1, MATCHES: 0, NOT_FOUND: 0, CANT_CHECK: 1 },
  noClaims: false,
  fixtureMode: false,
  fixtureBanner: null,
  claims: [
    {
      id: 'claim-1',
      type: 'SEBI_REGISTRATION',
      statement:
        'Sharma Investments is registered with SEBI (Research Analyst) under number INH000099991.',
      quote: 'Sharma Investments, SEBI RA INH000099991',
      verdict: 'CONTRADICTED',
      verdictLabel: 'CONTRADICTED',
      explanation:
        "SEBI's register shows INH000099991 is registered to ABC RESEARCH PRIVATE LIMITED (Pune) — a different name.",
      caveats: [],
      evidence: [
        {
          id: 'ev-1',
          title: 'SEBI register entry: INH000099991 (Research Analyst)',
          sourceName: "SEBI's register of intermediaries",
          kind: 'registry_record',
          fields: [{ key: 'name', label: 'Name', value: 'ABC RESEARCH PRIVATE LIMITED' }],
          url: 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14',
          asOf: '2026-10-03',
          retrievedAt: '2026-10-04T02:00:00Z',
          isFixture: false,
        },
      ],
      rules: [],
      legibility: 'clear',
    },
    {
      id: 'claim-2',
      type: 'PAYMENT_DESTINATION',
      statement: 'Payment should go to UPI ID abc@ybl.',
      quote: 'Pay to abc@ybl',
      verdict: 'CANT_CHECK',
      verdictLabel: "CAN'T CHECK",
      explanation: "We can't check who owns abc@ybl.",
      caveats: [],
      evidence: [],
      rules: [],
      legibility: 'clear',
    },
  ],
  bindings: [
    {
      id: 'binding-1',
      officialName: 'ABC RESEARCH PRIVATE LIMITED',
      registrationNumber: 'INH000099991',
      claimedName: 'Sharma Investments',
      rows: [
        {
          field: 'name',
          fieldLabel: 'Name',
          inMessage: 'Sharma Investments',
          inRecord: 'ABC RESEARCH PRIVATE LIMITED',
          status: 'different',
          statusLabel: 'Different',
        },
        {
          field: 'website',
          fieldLabel: 'Website',
          inMessage: 'sharma-investments.co.in',
          inRecord: 'abcresearch.in',
          status: 'not_in_record',
          statusLabel: 'Not on record',
        },
      ],
    },
  ],
  findings: [],
  unchecked: [
    {
      id: 'u-1',
      text: 'Who owns the phone number(s) — there is no public register we can check.',
      cause: 'no_source',
    },
  ],
  nextSteps: [{ id: 'pause', text: 'Pause before paying.', href: null, phone: null }],
  sources: [
    {
      id: 'sebi_intermediaries',
      name: "SEBI's register of intermediaries",
      status: 'ok',
      mode: 'snapshot',
      asOf: '2026-10-03',
      retrievedAt: null,
      stale: false,
      isFixture: false,
    },
  ],
  extracted: {
    segments: [
      {
        id: 'seg-1',
        origin: 'text',
        quality: 'good',
        text: 'Sharma Investments, SEBI RA INH000099991',
      },
    ],
    identifiers: [],
  },
  graph: { nodes: [], edges: [] },
  labels: {},
};

function withApp(ui: React.ReactNode) {
  return (
    <AppContext.Provider value={{ lang: 'en', setLang: () => undefined, meta: null }}>
      {ui}
    </AppContext.Provider>
  );
}

describe('Report', () => {
  it('shows one stamp per claim, the evidence, and the channel binding', () => {
    render(withApp(<Report view={VIEW} expiresAt="2026-10-11T08:00:00Z" />));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(VIEW.headline);
    expect(screen.getAllByRole('img').map((s) => s.getAttribute('aria-label'))).toEqual([
      'CONTRADICTED',
      "CAN'T CHECK",
    ]);
    expect(
      screen.getByRole('heading', { name: 'Who is contacting you, and who is registered' }),
    ).toBeTruthy();
    expect(screen.getByText('Different')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Could not check' })).toBeTruthy();
    expect(screen.getByText('Open the official source').getAttribute('href')).toContain(
      'sebi.gov.in',
    );
  });

  it('never shows an overall safety verdict', () => {
    const { container } = render(withApp(<Report view={VIEW} expiresAt="2026-10-11T08:00:00Z" />));
    const text = container.textContent!.toLowerCase();
    expect(text).not.toMatch(/\b(scam|fraudster)\b/);
    expect(text).not.toMatch(/risk score|safety score|trust score/);
    // The only stamps are per-claim stamps inside the claim list.
    expect(container.querySelectorAll('.report__head .stamp')).toHaveLength(0);
  });
});

describe('Composer', () => {
  it('asks for input instead of submitting an empty check', () => {
    render(withApp(<Composer />));
    fireEvent.click(screen.getByRole('button', { name: 'Investigate' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Paste the message/);
  });

  it('fills a sample message', () => {
    render(withApp(<Composer />));
    fireEvent.click(screen.getByRole('button', { name: 'Crypto doubling' }));
    expect(
      (screen.getByLabelText('The message you received') as HTMLTextAreaElement).value,
    ).toMatch(/Double your money/);
  });
});
