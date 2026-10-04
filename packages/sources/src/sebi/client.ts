import { fetchBytes, fetchText, HttpError } from '../http.js';
import {
  exportUrl,
  INACTIVE_SEARCH_INTM_IDS,
  LIVE_SEARCH_INTM_IDS,
  SEBI_BASE,
} from './categories.js';

/**
 * Talks to SEBI's public intermediary pages. SEBI's firewall rejects POSTs without a Referer on
 * sebi.gov.in (HTTP 530); GET exports need none. Requests are spaced to stay polite.
 */
export class SebiClient {
  constructor(private readonly opts: { minIntervalMs?: number; timeoutMs?: number } = {}) {}

  private post(path: string, form: Record<string, string>): Promise<string> {
    return fetchText(`${SEBI_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${SEBI_BASE}/` },
      body: new URLSearchParams(form).toString(),
      timeoutMs: this.opts.timeoutMs ?? 12_000,
      minIntervalMs: this.opts.minIntervalMs ?? 1_500,
      retries: 1,
      maxBytes: 2_000_000,
    }).then(({ status, text }) => {
      if (status !== 200 || /Unauthorized Request Blocked/i.test(text))
        throw new HttpError(`SEBI responded ${status}`, status, path);
      return text;
    });
  }

  /** Exact, case-insensitive registration-number search across all current registers. */
  searchByNumber(regNo: string): Promise<string> {
    return this.post('/sebiweb/ajax/other/getintmfpiinfo.jsp', {
      intmId: '0',
      intmIds: LIVE_SEARCH_INTM_IDS,
      next: 's',
      doDirect: '-1',
      regNo: regNo.trim(),
    });
  }

  /** Substring name search across all current registers (first page). */
  searchByName(name: string): Promise<string> {
    return this.post('/sebiweb/ajax/other/getintmfpiinfo.jsp', {
      intmId: '0',
      intmIds: LIVE_SEARCH_INTM_IDS,
      next: 's',
      doDirect: '-1',
      name: name.trim(),
    });
  }

  /** SEBI's list of cancelled / surrendered / expired / suspended registrations. */
  searchInactive(regNo: string): Promise<string> {
    return this.post('/sebiweb/ajax/other/getintmfpiinfo2.jsp', {
      intmId: '-1',
      intmIds: INACTIVE_SEARCH_INTM_IDS,
      next: 's',
      doDirect: '-1',
      regStatus: '',
      regNo: regNo.trim(),
    });
  }

  async fetchExport(intmId: number): Promise<Uint8Array> {
    const { status, bytes } = await fetchBytes(exportUrl(intmId), {
      timeoutMs: 60_000,
      minIntervalMs: this.opts.minIntervalMs ?? 2_000,
      retries: 2,
      maxBytes: 25_000_000,
    });
    // The export is a legacy Excel (OLE2) file: D0 CF 11 E0.
    if (status !== 200 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf)
      throw new HttpError(`unexpected export response (${status})`, status, exportUrl(intmId));
    return bytes;
  }
}
