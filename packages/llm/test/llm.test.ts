import { ModelExtraction } from '@jaanch/core';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractJson,
  mergeTileTexts,
  NimClient,
  prepareImageTiles,
  stripReasoning,
} from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY_EXTRACTION = {
  investmentRelated: false,
  sender: null,
  registrationClaims: [],
  organizations: [],
  persons: [],
  endorsements: [],
  returnPromises: [],
  paymentRequests: [],
  appInstalls: [],
  specialAccess: [],
  pressure: [],
};

function completion(content: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('JSON handling', () => {
  it('extracts JSON from fenced or chatty model output', () => {
    expect(extractJson('Sure!\n```json\n{"a": "b}"}\n```')).toEqual({ a: 'b}' });
    expect(extractJson('Result: {"x": [1, {"y": 2}]} hope that helps')).toEqual({
      x: [1, { y: 2 }],
    });
    expect(extractJson('no json here')).toBeNull();
  });
  it('removes reasoning blocks', () => {
    expect(stripReasoning('<think>secret plan</think>{"ok":true}')).toBe('{"ok":true}');
  });
});

describe('NimClient', () => {
  it('falls through JSON modes when a model ignores the constraint, then remembers the working one', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      // json_schema "accepted" but ignored → prose; guided_json works.
      if (body.response_format) return completion('Here is what I found: nothing much.');
      if (body.guided_json) return completion(JSON.stringify(EMPTY_EXTRACTION));
      return completion('?');
    });
    const client = new NimClient({ apiKey: 'k', baseUrl: 'https://nim.test/v1', timeoutMs: 5_000 });
    const out = await client.chatJson({
      model: 'm',
      schema: ModelExtraction,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(out.investmentRelated).toBe(false);
    expect(
      bodies.map((b) =>
        Object.keys(b).find((k) => ['response_format', 'guided_json', 'nvext'].includes(k)),
      ),
    ).toEqual(['response_format', 'guided_json']);
    bodies.length = 0;
    await client.chatJson({
      model: 'm',
      schema: ModelExtraction,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.guided_json).toBeTruthy();
  });

  it('follows the NVCF 202 → poll protocol', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.endsWith('/chat/completions'))
        return new Response('', { status: 202, headers: { 'NVCF-REQID': 'req-1' } });
      return completion('{"text":"ok"}');
    });
    const client = new NimClient({ apiKey: 'k', baseUrl: 'https://nim.test/v1', timeoutMs: 5_000 });
    expect(await client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })).toBe(
      '{"text":"ok"}',
    );
    expect(calls[1]).toBe('https://nim.test/v1/status/req-1');
  });

  it('retries rate limits and turns thinking off for reasoning-capable models', async () => {
    let n = 0;
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      n += 1;
      return n === 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
        : completion('<think>hmm</think>hello');
    });
    const client = new NimClient({ apiKey: 'k', baseUrl: 'https://nim.test/v1', timeoutMs: 5_000 });
    expect(
      await client.chat({
        model: 'google/gemma-4-31b-it',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).toBe('hello');
    expect(seen[0]!.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('abandons an attempt stuck in the queue and retries within the overall budget', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      n += 1;
      if (n === 1) {
        // First request never answers until it is aborted (a request stuck in the queue).
        return new Promise<Response>((_, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );
      }
      return completion('second attempt');
    });
    const client = new NimClient({
      apiKey: 'k',
      baseUrl: 'https://nim.test/v1',
      timeoutMs: 60_000,
    });
    const started = Date.now();
    const out = await client.chat({
      model: 'meta/muse-glimmer-30b',
      messages: [{ role: 'user', content: 'x' }],
      attemptTimeoutMs: 200,
      signal: AbortSignal.timeout(10_000),
    });
    expect(out).toBe('second attempt');
    expect(n).toBe(2);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reports retired models', async () => {
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 410 }));
    const client = new NimClient({ apiKey: 'k', baseUrl: 'https://nim.test/v1', timeoutMs: 5_000 });
    expect((await client.modelStatus('meta/llama-4-maverick-17b-128e-instruct')).status).toBe(
      'retired',
    );
  });
});

describe('screenshot preparation', () => {
  it('splits tall screenshots into tiles within the inline budget', async () => {
    const tall = await sharp({
      create: { width: 1080, height: 3200, channels: 3, background: '#f2f2f2' },
    })
      .png()
      .toBuffer();
    const tiles = await prepareImageTiles(new Uint8Array(tall), { maxInlineBytes: 180_000 });
    expect(tiles.length).toBeGreaterThan(1);
    for (const t of tiles) {
      expect(t.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(t.dataUrl.length - 'data:image/jpeg;base64,'.length).toBeLessThanOrEqual(180_000);
    }
  });

  it('merges tile transcripts without duplicating overlapped lines', () => {
    expect(mergeTileTexts(['A\nB\nC', 'C\nD'])).toBe('A\nB\nC\nD');
  });
});

describe('tail latency', () => {
  it('sends a hedged duplicate when the first attempt is slow, and cancels the loser', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      if (signals.length === 1) {
        // The first request sits in the queue until it is cancelled.
        return new Promise<Response>((_, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );
      }
      return completion('from the hedge');
    });
    const client = new NimClient({
      apiKey: 'k',
      baseUrl: 'https://nim.test/v1',
      timeoutMs: 60_000,
    });
    const started = Date.now();
    const out = await client.chat({
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      messages: [{ role: 'user', content: 'x' }],
      attemptTimeoutMs: 30_000,
      hedgeAfterMs: 100,
      signal: AbortSignal.timeout(10_000),
    });
    expect(out).toBe('from the hedge');
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true); // the stuck request was cancelled
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives the schema in the prompt when decoding is not schema-constrained', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return completion('{"investmentRelated": false}');
    });
    const client = new NimClient({ apiKey: 'k', baseUrl: 'https://nim.test/v1', timeoutMs: 5_000 });
    const out = await client.chatJson({
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      schema: ModelExtraction,
      modes: ['prompt'],
      messages: [
        { role: 'system', content: 'Extract claims.' },
        { role: 'user', content: 'hello' },
      ],
    });
    expect(out.investmentRelated).toBe(false);
    const system = (bodies[0]!.messages as Array<{ role: string; content: string }>)[0]!;
    expect(system.content).toMatch(/^Extract claims\.\n\nReply with only one JSON object/);
    expect(system.content).toContain('"registrationClaims"');
    expect(bodies[0]!.response_format).toBeUndefined();
  });
});
