/**
 * ============================== FIXTURE DATA ==============================
 * Fictional records for local development, automated tests and the offline demo backup.
 * They are NOT SEBI or RBI data and describe no real entity. Any registration numbers here are
 * deliberately in an unused range. Reports produced from fixtures carry a visible
 * "DEVELOPMENT DATA" banner (isFixture=true), and the server refuses fixture mode in production.
 * ==========================================================================
 */
import type { RegistryCategory, RegistryRecord } from '@jaanch/core';
import type { AlertListRepo, RegistryRepo, SnapshotsRepo } from '@jaanch/db';
import { RBI_ALERT_SOURCE_ID } from './rbi/alert-list.js';
import { SEBI_REGISTRY_SOURCE, SEBI_SOURCE_ID } from './sebi/ingest.js';

const listing = (id: number) =>
  `https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=${id}`;

export const FIXTURE_REGISTRY: RegistryRecord[] = [
  {
    registrationNumber: 'INH000099991',
    category: 'RA',
    categoryLabel: 'Research Analyst',
    names: ['ABC RESEARCH PRIVATE LIMITED'],
    tradeNames: [],
    contactPerson: 'Anita Rao',
    emails: ['compliance@abcresearch.in'],
    phones: ['02041234567'],
    address: '12 MG Road, PUNE, MAHARASHTRA, 411001',
    city: 'PUNE',
    state: 'MAHARASHTRA',
    validFrom: '2021-05-03',
    validTo: null,
    exchanges: [],
    sourceUrl: listing(14),
  },
  {
    registrationNumber: 'INH000099993',
    category: 'RA',
    categoryLabel: 'Research Analyst',
    names: ['RAHUL KUMAR SHARMA (Proprietor: Bull Insights)'],
    tradeNames: [],
    contactPerson: null,
    emails: ['rahul.bullinsights@gmail.com'],
    phones: ['9876500001'],
    address: 'Indore, MADHYA PRADESH, 452001',
    city: 'INDORE',
    state: 'MADHYA PRADESH',
    validFrom: '2022-01-10',
    validTo: null,
    exchanges: [],
    sourceUrl: listing(14),
  },
  {
    registrationNumber: 'INZ000099992',
    category: 'BROKER',
    categoryLabel: 'Stock Broker',
    names: ['ZENITH BROKING LIMITED'],
    tradeNames: ['ZENITH'],
    contactPerson: null,
    emails: ['support@zenithbroking.com'],
    phones: ['02240001234'],
    address: 'Lower Parel, MUMBAI, MAHARASHTRA, 400013',
    city: 'MUMBAI',
    state: 'MAHARASHTRA',
    validFrom: '2015-09-30',
    validTo: null,
    exchanges: ['NATIONAL STOCK EXCHANGE OF INDIA LTD'],
    sourceUrl: listing(30),
  },
  {
    registrationNumber: 'INA000099994',
    category: 'IA',
    categoryLabel: 'Investment Adviser',
    names: ['OLD ADVISORY SERVICES LLP'],
    tradeNames: [],
    contactPerson: null,
    emails: [],
    phones: [],
    address: null,
    city: 'DELHI',
    state: null,
    validFrom: '2016-01-01',
    validTo: '2021-12-31',
    exchanges: [],
    sourceUrl: listing(13),
  },
];

export const FIXTURE_ALERTS = [
  {
    name: 'Example FX Pro (FIXTURE)',
    websites: ['www.examplefxpro.com'],
    domains: ['examplefxpro.com'],
    listUrl: 'https://rbi.org.in/scripts/bs_viewcontent.aspx?Id=4235',
  },
];

/** Load fixtures as the current snapshot (marked is_fixture so every report shows it). */
export async function loadFixtures(deps: {
  registry: RegistryRepo;
  snapshots: SnapshotsRepo;
  alerts: AlertListRepo;
}): Promise<void> {
  const byCategory = new Map<RegistryCategory, RegistryRecord[]>();
  for (const r of FIXTURE_REGISTRY)
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  for (const category of ['RA', 'IA', 'BROKER', 'PMS'] as RegistryCategory[]) {
    const id = await deps.snapshots.start(SEBI_SOURCE_ID, category, null, true);
    const records = byCategory.get(category) ?? [];
    await deps.registry.replaceCategory(SEBI_REGISTRY_SOURCE, category, records, id);
    await deps.snapshots.succeed(id, {
      asOf: new Date().toISOString().slice(0, 10),
      recordCount: records.length,
      stats: { fixture: true },
    });
  }
  const alertId = await deps.snapshots.start(RBI_ALERT_SOURCE_ID, 'all', null, true);
  await deps.alerts.replaceAll(RBI_ALERT_SOURCE_ID, FIXTURE_ALERTS, alertId);
  await deps.snapshots.succeed(alertId, {
    asOf: new Date().toISOString().slice(0, 10),
    recordCount: FIXTURE_ALERTS.length,
    stats: { fixture: true },
  });
}
