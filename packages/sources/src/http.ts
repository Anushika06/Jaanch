/**
 * Small HTTP helper for official sources: timeouts, bounded retries on transient failures,
 * polite pacing per host, a descriptive User-Agent and a response-size cap.
 */
export const USER_AGENT =
  'Jaanch/1.0 (investor-protection; checks claims against official public registers)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
  }
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  /** Minimum spacing between requests to the same host. */
  minIntervalMs?: number;
}

const lastRequestAt = new Map<string, number>();

async function pace(host: string, minIntervalMs: number): Promise<void> {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  lastRequestAt.set(host, Math.max(Date.now(), last + minIntervalMs));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const TRANSIENT = new Set([429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 530]);

export async function fetchBytes(
  url: string,
  opts: HttpOptions = {},
): Promise<{ status: number; bytes: Uint8Array; headers: Headers }> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.minIntervalMs) await pace(host, opts.minIntervalMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: { 'User-Agent': USER_AGENT, ...opts.headers },
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        signal: controller.signal,
        redirect: 'follow',
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      if (opts.maxBytes && buf.byteLength > opts.maxBytes)
        throw new HttpError(`response too large (${buf.byteLength} bytes)`, res.status, url);
      if (TRANSIENT.has(res.status) && attempt < retries) {
        lastError = new HttpError(`HTTP ${res.status}`, res.status, url);
        await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
        continue;
      }
      return { status: res.status, bytes: buf, headers: res.headers };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(
    lastError instanceof Error ? lastError.message : String(lastError),
    null,
    url,
  );
}

export async function fetchText(
  url: string,
  opts: HttpOptions = {},
): Promise<{ status: number; text: string }> {
  const { status, bytes } = await fetchBytes(url, opts);
  return { status, text: new TextDecoder('utf-8').decode(bytes) };
}
