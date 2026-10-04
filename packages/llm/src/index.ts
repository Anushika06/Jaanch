import type { Extractor, Narrator, Reader } from '@jaanch/core';
import { NimExtractor, NimNarrator, NimReader } from './adapters.js';
import { ASR_FUNCTIONS, RivaAsr } from './asr.js';
import { NimClient, type LlmLogger, type ModelStatus } from './nim.js';

export {
  NimClient,
  NimError,
  stripReasoning,
  type ChatMessage,
  type LlmLogger,
  type ModelStatus,
} from './nim.js';
export { NimExtractor, NimNarrator, NimReader, mergeTileTexts } from './adapters.js';
export { RivaAsr, ASR_FUNCTIONS, toWav16k } from './asr.js';
export { extractJson, jsonSchemaFor, parseModelJson } from './json.js';
export { prepareImageTiles } from './image.js';

/**
 * Default models on NVIDIA's hosted API catalog. Hosted models are retired often (HTTP 410), so
 * every default can be overridden by environment variable and is checked at start-up; the
 * `probe` script compares candidates live.
 *
 * Measured 2026-10-04 on the demo screenshots and texts (English + Hindi): muse-glimmer read
 * every expected identifier and Hindi phrase (12–26 s per screenshot); nemotron-3.5-lightning
 * passed every extraction check (2–13 s). Larger models (gemma-4-31b, kimi-k3, deepseek-v4.1)
 * were queued on the free tier for over two minutes per request at the time.
 *
 * Later the same day muse-glimmer started answering 404 ("Function … Not found for account")
 * while still listed in /models; nemotron-3-nano-omni read every demo screenshot, identifiers
 * included, in 4–7 s.
 */
export const DEFAULT_MODELS = {
  vision: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  text: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  narrator: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  asr: 'openai/whisper-large-v3',
} as const;

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  visionModel?: string | undefined;
  textModel?: string | undefined;
  narratorModel?: string | undefined;
  asrModel?: string | undefined;
  timeoutMs: number;
  /** Inline image budget (base64 characters) per request. */
  maxInlineImageBytes?: number;
  logger?: LlmLogger;
}

export interface LlmBundle {
  reader: Reader | null;
  extractor: Extractor | null;
  narrator: Narrator | null;
  models: {
    vision: string | null;
    text: string | null;
    narrator: string | null;
    asr: string | null;
  };
  /** Check that every configured hosted model is still live. */
  checkModels(): Promise<Record<string, ModelStatus>>;
}

export function createLlm(config: LlmConfig): LlmBundle {
  const client = new NimClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    ...(config.logger ? { logger: config.logger } : {}),
  });
  const vision = config.visionModel ?? DEFAULT_MODELS.vision;
  const text = config.textModel ?? DEFAULT_MODELS.text;
  const narrator = config.narratorModel ?? DEFAULT_MODELS.narrator;
  const asrModel = config.asrModel === 'none' ? null : (config.asrModel ?? DEFAULT_MODELS.asr);
  const asr =
    asrModel && ASR_FUNCTIONS[asrModel]
      ? new RivaAsr({
          apiKey: config.apiKey,
          model: asrModel,
          timeoutMs: Math.max(config.timeoutMs, 60_000),
          ...(config.logger ? { logger: config.logger } : {}),
        })
      : undefined;
  return {
    reader: new NimReader(client, vision, {
      maxInlineBytes: config.maxInlineImageBytes ?? 180_000,
      ...(config.logger ? { logger: config.logger } : {}),
      ...(asr ? { asr } : {}),
    }),
    extractor: new NimExtractor(client, text),
    narrator: new NimNarrator(client, narrator),
    models: { vision, text, narrator, asr: asr ? asrModel : null },
    async checkModels() {
      const out: Record<string, ModelStatus> = {};
      for (const m of new Set([vision, text, narrator]))
        out[m] = (await client.modelStatus(m)).status;
      return out;
    },
  };
}
