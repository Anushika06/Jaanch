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
type JsonMode = 'json_schema' | 'guided_json' | 'nvext' | 'prompt';
const JSON_MODES: JsonMode[] = ['json_schema', 'guided_json', 'nvext', 'prompt'];

export class NimError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
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

  /** POST with retries; follows NVCF's asynchronous 202 → poll /status/{id} protocol. */
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        let res = await this.request('POST', path, body, controller.signal);
        while (res.status === 202) {
          const reqId = res.headers.get('nvcf-reqid');
          if (!reqId) throw new NimError('202 without NVCF-REQID', 202);
          await new Promise((r) => setTimeout(r, 500));
          res = await this.request(
            'GET',
            `/status/${encodeURIComponent(reqId)}`,
            undefined,
            controller.signal,
          );
        }
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as unknown;
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          lastErr = new NimError(`HTTP ${res.status}`, res.status);
          const retryAfter = Number(res.headers.get('retry-after'));
          await new Promise((r) =>
            setTimeout(
              r,
              Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : 1_500 * 2 ** attempt,
            ),
          );
          continue;
        }
        throw new NimError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      } catch (err) {
        if (err instanceof NimError) throw err;
        if (signal?.aborted) throw err;
        lastErr = err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr instanceof Error ? lastErr : new NimError(String(lastErr), null);
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
    try {
      data = (await this.post('/chat/completions', body, o.signal)) as typeof data;
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
      case 'prompt':
        return {};
    }
  }

  /**
   * Chat with a JSON result validated against a zod schema. Structured modes are tried in order;
   * plain prompting gets one repair round. Never returns unvalidated data.
   */
  async chatJson<T>(o: ChatOptions & { schema: z.ZodType<T> }): Promise<T> {
    const schemaJson = jsonSchemaFor(o.schema);
    const learned = this.jsonModes.get(o.model);
    const modes = learned ? [learned, ...JSON_MODES.filter((m) => m !== learned)] : JSON_MODES;
    let lastError = '';
    for (const mode of modes) {
      let text: string;
      try {
        text = await this.chat({ ...o, extra: this.extraFor(mode, schemaJson) });
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
        this.jsonModes.set(o.model, mode);
        return parsed.value;
      }
      lastError = parsed.error;
      if (mode !== 'prompt') continue; // the constraint was probably ignored; try the next mode
      const repaired = await this.chat({
        ...o,
        messages: [
          ...o.messages,
          { role: 'assistant', content: text.slice(0, 6_000) },
          {
            role: 'user',
            content: `That output was not valid (${parsed.error}). Reply with only the corrected JSON object, nothing else.`,
          },
        ],
      });
      const second = parseModelJson(repaired, o.schema);
      if (second.ok) {
        this.jsonModes.set(o.model, 'prompt');
        return second.value;
      }
      lastError = second.error;
    }
    throw new NimError(`model output failed validation: ${lastError}`, null);
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url('/models'), {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new NimError(`HTTP ${res.status}`, res.status);
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id).sort();
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
