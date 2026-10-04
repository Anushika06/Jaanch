import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { jsonSchemaFor, parseModelJson } from './json.js';

export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * Give up on one attempt after this long and retry (within `signal`'s overall budget). Hosted
   * endpoints occasionally leave a request queued for minutes while a fresh one answers in
   * seconds, so a stuck attempt is abandoned early. Defaults to the client's `timeoutMs`.
   */
  attemptTimeoutMs?: number;
  /** Start a second, identical attempt if the first hasn't answered after this long. */
  hedgeAfterMs?: number;
}

export interface LlmLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Ways a hosted model may accept a JSON constraint, in the order NVIDIA's own client tries them.
 * Some models silently ignore unsupported fields and answer free text with HTTP 200, so a mode is
 * only "learned" once it has produced output that validates.
 */
export type JsonMode = 'json_schema' | 'guided_json' | 'nvext' | 'json_object' | 'prompt';
const JSON_MODES: JsonMode[] = ['json_schema', 'guided_json', 'nvext', 'json_object', 'prompt'];
/** Modes that constrain decoding to the schema itself; the others are told the schema instead. */
const SCHEMA_CONSTRAINED: ReadonlySet<JsonMode> = new Set(['json_schema', 'guided_json', 'nvext']);

const MAX_ATTEMPTS = 3;

export class NimError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  constructor(
    message: string,
    readonly status: number | null,
    opts: { retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export type ModelStatus = 'live' | 'retired' | 'unknown' | 'error';

/** Reasoning models emit <think>…</think>; only the answer after it is used. */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

/** Append a note to the system message (or add one), leaving the conversation otherwise intact. */
function withSystemNote(messages: ChatMessage[], note: string): ChatMessage[] {
  const [first, ...rest] = messages;
  if (first?.role === 'system' && typeof first.content === 'string')
    return [{ role: 'system', content: `${first.content}\n\n${note}` }, ...rest];
  return [{ role: 'system', content: note }, ...messages];
}

/** Models whose chat template supports turning "thinking" off (faster, cheaper, cleaner JSON). */
const THINKING_TOGGLE = /gemma-4|nemotron-3|reasoning|glm-5|kimi-k3|deepseek-v4/i;

/**
 * Client for NVIDIA NIM's OpenAI-compatible chat completions API
 * (https://integrate.api.nvidia.com/v1). Written against fetch for full control over
 * NVIDIA-specific behaviour: 202 + NVCF-REQID polling, per-model JSON modes, thinking toggles.
 */
export class NimClient {
  private readonly jsonModes = new Map<string, JsonMode>();
  private readonly noThinkingToggle = new Set<string>();

  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      logger?: LlmLogger;
    },
  ) {}

  private url(path: string) {
    return `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    return fetch(this.url(path), {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  }

  /** One attempt: POST, then follow NVCF's asynchronous 202 → poll /status/{id} protocol. */
  private async attemptOnce(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    let res = await this.request('POST', path, body, signal);
    while (res.status === 202) {
      const reqId = res.headers.get('nvcf-reqid');
      if (!reqId) throw new NimError('202 without NVCF-REQID', 202);
      await new Promise((r) => setTimeout(r, 500));
      res = await this.request('GET', `/status/${encodeURIComponent(reqId)}`, undefined, signal);
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as unknown;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new NimError(`HTTP ${res.status}`, res.status, {
        retryable: true,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
      });
    }
    throw new NimError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }

  /**
   * POST with retries and hedging. Hosted endpoints occasionally leave a request queued for a
   * minute or more while an identical one is answered in seconds, so when `hedgeAfterMs` passes
   * without an answer a second attempt is started and whichever succeeds first wins (the other is
   * cancelled). Failed attempts (timeouts, network errors, 429/5xx) are retried, up to three
   * attempts in all; other HTTP errors are final. `signal` bounds the whole call.
   */
  private post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    timing: { attemptTimeoutMs?: number | undefined; hedgeAfterMs?: number | undefined } = {},
  ): Promise<unknown> {
    const attemptTimeoutMs = timing.attemptTimeoutMs ?? this.opts.timeoutMs;
    const model = (body as { model?: string }).model;
    return new Promise<unknown>((resolve, reject) => {
      const running = new Set<AbortController>();
      let launched = 0;
      let settled = false;
      let lastErr: unknown = null;
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        signal?.removeEventListener('abort', onOuterAbort);
        for (const c of running) c.abort();
        finish();
      };
      const onOuterAbort = () =>
        settle(() => reject(signal?.reason ?? new DOMException('aborted', 'AbortError')));

      const launch = () => {
        if (settled || launched >= MAX_ATTEMPTS) return;
        const attempt = ++launched;
        const controller = new AbortController();
        running.add(controller);
        const started = Date.now();
        const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
        this.attemptOnce(path, body, controller.signal).then(
          (value) => {
            clearTimeout(timer);
            settle(() => resolve(value));
          },
          (err: unknown) => {
            clearTimeout(timer);
            running.delete(controller);
            if (settled) return;
            if (err instanceof NimError && !err.retryable) return settle(() => reject(err));
            lastErr = err;
            this.opts.logger?.warn(
              {
                path,
                model,
                attempt,
                ms: Date.now() - started,
                error: controller.signal.aborted ? 'attempt timed out' : String(err).slice(0, 120),
              },
              'model request attempt failed',
            );
            if (running.size > 0) return; // a hedged attempt is still running
            if (launched >= MAX_ATTEMPTS) return settle(() => reject(lastErr));
            const backoff =
              err instanceof NimError && err.retryAfterMs !== undefined
                ? err.retryAfterMs
                : 1_000 * 2 ** (attempt - 1);
            setTimeout(launch, backoff);
          },
        );
      };

      if (signal?.aborted) return onOuterAbort();
      signal?.addEventListener('abort', onOuterAbort, { once: true });
      launch();
      if (timing.hedgeAfterMs !== undefined)
        hedgeTimer = setTimeout(() => {
          if (running.size === 1 && launched < MAX_ATTEMPTS) {
            this.opts.logger?.info(
              { path, model },
              'model request slow; sending a hedged duplicate',
            );
            launch();
          }
        }, timing.hedgeAfterMs);
    });
  }

  async chat(o: ChatOptions & { extra?: Record<string, unknown> }): Promise<string> {
    const thinkingOff = THINKING_TOGGLE.test(o.model) && !this.noThinkingToggle.has(o.model);
    const body = {
      model: o.model,
      messages: o.messages,
      max_tokens: o.maxTokens ?? 2048,
      temperature: o.temperature ?? 0,
      top_p: 1,
      stream: false,
      ...(thinkingOff ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      ...o.extra,
    };
    let data: { choices?: Array<{ message?: { content?: string | null } }> };
    const started = Date.now();
    try {
      data = (await this.post('/chat/completions', body, o.signal, {
        attemptTimeoutMs: o.attemptTimeoutMs,
        hedgeAfterMs: o.hedgeAfterMs,
      })) as typeof data;
      this.opts.logger?.info({ model: o.model, ms: Date.now() - started }, 'model call completed');
    } catch (err) {
      // Some models reject the thinking toggle; remember and retry once without it.
      if (
        thinkingOff &&
        err instanceof NimError &&
        err.status !== null &&
        err.status >= 400 &&
        err.status < 500 &&
        /chat_template_kwargs|enable_thinking/i.test(err.message)
      ) {
        this.noThinkingToggle.add(o.model);
        return this.chat(o);
      }
      throw err;
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim())
      throw new NimError('empty completion', null);
    return stripReasoning(content);
  }

  private extraFor(mode: JsonMode, schema: Record<string, unknown>): Record<string, unknown> {
    switch (mode) {
      case 'json_schema':
        return {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'result', schema, strict: true },
          },
        };
      case 'guided_json':
        return { guided_json: schema };
      case 'nvext':
        return { nvext: { guided_json: schema } };
      case 'json_object':
        return { response_format: { type: 'json_object' } };
      case 'prompt':
        return {};
    }
  }

  /**
   * Chat with a JSON result validated against a zod schema. JSON modes are tried in order
   * (`modes`, default: schema-constrained first); in the unconstrained modes the schema is given
   * in the prompt, and plain prompting gets one repair round. Never returns unvalidated data.
   *
   * Schema-constrained decoding makes the host compile a grammar for the schema, which for a large
   * schema can stall a request on a cold worker for over a minute — callers with large schemas
   * may prefer the unconstrained modes, which are validated just the same.
   */
  async chatJson<T>(o: ChatOptions & { schema: z.ZodType<T>; modes?: JsonMode[] }): Promise<T> {
    const schemaJson = jsonSchemaFor(o.schema);
    const learnedKey = `${o.model}#${createHash('sha1').update(JSON.stringify(schemaJson)).digest('base64url').slice(0, 10)}`;
    const learned = this.jsonModes.get(learnedKey);
    const preferred = o.modes ?? JSON_MODES;
    const modes = learned ? [learned, ...preferred.filter((m) => m !== learned)] : preferred;
    const schemaNote = `Reply with only one JSON object that matches this JSON Schema exactly (same field names, nesting and enum values; use null or [] when something is absent):\n${JSON.stringify(schemaJson)}`;
    let lastError = '';
    for (const mode of modes) {
      const messages = SCHEMA_CONSTRAINED.has(mode)
        ? o.messages
        : withSystemNote(o.messages, schemaNote);
      let text: string;
      try {
        text = await this.chat({ ...o, messages, extra: this.extraFor(mode, schemaJson) });
      } catch (err) {
        if (
          err instanceof NimError &&
          err.status !== null &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 429 &&
          mode !== 'prompt'
        ) {
          lastError = err.message;
          continue; // this JSON mode is not accepted by the model
        }
        throw err;
      }
      const parsed = parseModelJson(text, o.schema);
      if (parsed.ok) {
        if (learned !== mode)
          this.opts.logger?.info({ model: o.model, mode }, 'json mode selected for model');
        this.jsonModes.set(learnedKey, mode);
        return parsed.value;
      }
      lastError = parsed.error;
      if (mode !== 'prompt') continue; // the constraint was probably ignored; try the next mode
      const repaired = await this.chat({
        ...o,
        messages: [
          ...messages,
          { role: 'assistant', content: text.slice(0, 6_000) },
          {
            role: 'user',
            content: `That output was not valid (${parsed.error}). Reply with only the corrected JSON object, nothing else.`,
          },
        ],
      });
      const second = parseModelJson(repaired, o.schema);
      if (second.ok) {
        this.jsonModes.set(learnedKey, 'prompt');
        return second.value;
      }
      lastError = second.error;
    }
    throw new NimError(`model output failed validation: ${lastError}`, null);
  }

  async listModels(): Promise<string[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(this.url('/models'), {
          headers: { Authorization: `Bearer ${this.opts.apiKey}` },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (!res.ok) throw new NimError(`HTTP ${res.status}`, res.status);
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return (data.data ?? []).map((m) => m.id).sort();
      } catch (err) {
        // Retry transient network failures (and 5xx) once; auth and client errors are final.
        const retryable = !(err instanceof NimError) || (err.status ?? 0) >= 500;
        if (!retryable || attempt >= 1) throw err;
        await new Promise((r) => setTimeout(r, 1_500));
      }
    }
  }

  /** 200 = live, 410 = retired (end of life), 404 = unknown. Hosted models change often. */
  async modelStatus(model: string): Promise<{ status: ModelStatus; detail: string | null }> {
    try {
      const res = await fetch(this.url(`/models/${model}`), {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { status: 'live', detail: null };
      const detail = (await res.text()).slice(0, 200);
      if (res.status === 410) return { status: 'retired', detail };
      if (res.status === 404) return { status: 'unknown', detail };
      return { status: 'error', detail: `HTTP ${res.status}` };
    } catch (err) {
      return { status: 'error', detail: String(err) };
    }
  }
}
