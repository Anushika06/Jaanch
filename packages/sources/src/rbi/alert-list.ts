import {
  foldForMatch,
  registrableDomain,
  type AlertListMatch,
  type AlertListPort,
  type AlertListResult,
  type SourceAccess,
} from '@jaanch/core';
import type { AlertEntryRow, AlertListRepo, SnapshotsRepo } from '@jaanch/db';
import * as cheerio from 'cheerio';
import { fetchText, HttpError } from '../http.js';

export const RBI_ALERT_SOURCE_ID = 'rbi_alert_list';
export const RBI_ALERT_URL = 'https://rbi.org.in/scripts/bs_viewcontent.aspx?Id=4235';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export interface ParsedAlertList {
  asOf: string | null;
  entries: AlertEntryRow[];
}

/**
 * Parse RBI's Alert List page: an HTML table "Sr. No | Name | Website" of entities not
 * authorised to deal in forex or operate electronic forex trading platforms.
 */
export function parseRbiAlertList(html: string): ParsedAlertList {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\s+/g, ' ');
  const m = /updated\s+as\s+on\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  const month = m ? MONTHS.indexOf(m[1]!.toLowerCase()) + 1 : 0;
  const asOf =
    m && month > 0 ? `${m[3]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;

  const entries: AlertEntryRow[] = [];
  $('table').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    const header = rows.length ? $(rows[0]).text().toLowerCase() : '';
    if (!header.includes('name') || !header.includes('website')) return;
    for (const row of rows.slice(1)) {
      const cells = $(row)
        .find('td')
        .toArray()
        .map((c) => $(c).text().replace(/\s+/g, ' ').trim());
      if (cells.length < 3) continue;
      const name = cells[1]!;
      if (!name) continue;
      const websites = cells[2]!
        .split(/[\s,;]+/)
        .map((w) => w.trim())
        .filter((w) => /\.[a-z]{2,}/i.test(w));
      const domains = [
        ...new Set(
          websites
            .map((w) => registrableDomain(w.replace(/^https?:\/\//i, '').split('/')[0] ?? ''))
            .filter((d): d is string => !!d),
        ),
      ];
      entries.push({ name, websites, domains, listUrl: RBI_ALERT_URL });
    }
  });
  return { asOf, entries };
}

export async function ingestRbiAlertList(deps: {
  repo: AlertListRepo;
  snapshots: SnapshotsRepo;
}): Promise<{ ok: boolean; entries: number; asOf: string | null; error?: string }> {
  const snapshotId = await deps.snapshots.start(RBI_ALERT_SOURCE_ID, 'all', RBI_ALERT_URL, false);
  try {
    const { status, text } = await fetchText(RBI_ALERT_URL, { timeoutMs: 30_000, retries: 2 });
    if (status !== 200) throw new HttpError(`RBI responded ${status}`, status, RBI_ALERT_URL);
    const parsed = parseRbiAlertList(text);
    if (parsed.entries.length < 10)
      throw new Error(
        `unexpectedly few entries (${parsed.entries.length}); page layout may have changed`,
      );
    await deps.repo.replaceAll(RBI_ALERT_SOURCE_ID, parsed.entries, snapshotId);
    await deps.snapshots.succeed(snapshotId, {
      asOf: parsed.asOf,
      recordCount: parsed.entries.length,
    });
    return { ok: true, entries: parsed.entries.length, asOf: parsed.asOf };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.snapshots.fail(snapshotId, message);
    return { ok: false, entries: 0, asOf: null, error: message };
  }
}

/**
 * Match names and domains against the Alert List. Matching is deliberately strict — exact
 * (folded) names, multi-word names as whole phrases, exact registrable domains — because a hit
 * is shown to the investor as a high-severity warning.
 */
export class RbiAlertList implements AlertListPort {
  private cache: { at: number; entries: AlertEntryRow[]; access: SourceAccess } | null = null;

  constructor(
    private readonly repo: AlertListRepo,
    private readonly snapshots: SnapshotsRepo,
  ) {}

  private async load(): Promise<{ entries: AlertEntryRow[]; access: SourceAccess } | null> {
    if (this.cache && Date.now() - this.cache.at < 10 * 60_000) return this.cache;
    const snap = (await this.snapshots.latestSucceeded(RBI_ALERT_SOURCE_ID))[0];
    if (!snap) return null;
    const entries = await this.repo.list(RBI_ALERT_SOURCE_ID);
    const access: SourceAccess = {
      mode: 'snapshot',
      asOf: snap.asOf,
      retrievedAt: snap.completedAt?.toISOString() ?? null,
      stale: snap.completedAt ? Date.now() - snap.completedAt.getTime() > 14 * 86_400_000 : true,
      isFixture: snap.isFixture,
    };
    this.cache = { at: Date.now(), entries, access };
    return this.cache;
  }

  async match(query: { names: string[]; domains: string[] }): Promise<AlertListResult> {
    const loaded = await this.load();
    if (!loaded) {
      return {
        status: 'unavailable',
        matches: [],
        access: { mode: 'snapshot', asOf: null, retrievedAt: null, stale: true, isFixture: false },
        error: 'no snapshot',
      };
    }
    const matches: AlertListMatch[] = [];
    const folded = query.names.map((n) => ({
      raw: n,
      f: ` ${foldForMatch(n)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()} `,
    }));
    for (const entry of loaded.entries) {
      const e = foldForMatch(entry.name)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      const multiWord = e.split(' ').length >= 2 || e.length >= 8;
      for (const q of folded) {
        if (q.f.trim() === e || (multiWord && q.f.includes(` ${e} `))) {
          matches.push({ entry: { ...entry }, matchedOn: 'name', query: q.raw });
        }
      }
      for (const d of query.domains) {
        if (entry.domains.includes(d.toLowerCase()))
          matches.push({ entry: { ...entry }, matchedOn: 'domain', query: d });
      }
    }
    return { status: 'ok', matches, access: loaded.access };
  }
}
