import {
  ModelExtraction,
  ModelIdentifierReading,
  ModelImageReading,
  ModelNarrative,
  type AudioMime,
  type Extractor,
  type ImageMime,
  type NarrativeFacts,
  type Narrator,
  type Reader,
} from '@jaanch/core';
import type { RivaAsr } from './asr.js';
import { prepareImageTiles } from './image.js';
import type { LlmLogger, NimClient } from './nim.js';
import {
  EXTRACT_SYSTEM,
  extractUser,
  narrateSystem,
  narrateUser,
  READ_IDENTIFIERS_USER,
  READ_IMAGE_SYSTEM,
  READ_IMAGE_USER,
} from './prompts.js';

const QUALITY_RANK = { good: 0, partial: 1, poor: 2, unreadable: 3 } as const;

/**
 * Per-attempt limits, about twice the slowest normal response measured on the hosted endpoints
 * (2026-10-04: screenshot 12–26 s, identifier re-read 7–11 s, extraction 2–13 s). A request
 * still queued after that is abandoned and retried; the engine's per-stage timeout caps the total.
 */
const ATTEMPT_TIMEOUT_MS = {
  readImage: 45_000,
  readIdentifiers: 25_000,
  extract: 25_000,
  narrate: 15_000,
} as const;
/** Send a duplicate request when the first hasn't answered by roughly the slow end of normal. */
const HEDGE_AFTER_MS = {
  readImage: 30_000,
  readIdentifiers: 15_000,
  extract: 15_000,
  narrate: 8_000,
} as const;

/** Merge per-tile transcripts, dropping lines duplicated by the tile overlap. */
export function mergeTileTexts(texts: string[]): string {
  const out: string[] = [];
  for (const t of texts) {
    const lines = t.split('\n');
    // Skip leading lines of this tile that repeat the tail of what we already have.
    let skip = 0;
    const tail = out.slice(-8).map((l) => l.trim());
    while (
      skip < lines.length &&
      skip < 8 &&
      lines[skip]!.trim() &&
      tail.includes(lines[skip]!.trim())
    )
      skip++;
    out.push(...lines.slice(skip));
  }
  return out.join('\n').trim();
}

export class NimReader implements Reader {
  readonly transcribeAudio?: Reader['transcribeAudio'];

  constructor(
    private readonly client: NimClient,
    readonly modelId: string,
    private readonly opts: { maxInlineBytes: number; logger?: LlmLogger; asr?: RivaAsr },
  ) {
    const asr = opts.asr;
    if (asr)
      this.transcribeAudio = (bytes: Uint8Array, mime: AudioMime, signal: AbortSignal) =>
        asr.transcribe(bytes, mime, signal);
  }

  async readImage(bytes: Uint8Array, _mime: ImageMime, signal: AbortSignal) {
    const tiles = await prepareImageTiles(bytes, { maxInlineBytes: this.opts.maxInlineBytes });
    const readings = [];
    for (const tile of tiles) {
      readings.push(
        await this.client.chatJson({
          model: this.modelId,
          schema: ModelImageReading,
          maxTokens: 3000,
          signal,
          attemptTimeoutMs: ATTEMPT_TIMEOUT_MS.readImage,
          hedgeAfterMs: HEDGE_AFTER_MS.readImage,
          messages: [
            { role: 'system', content: READ_IMAGE_SYSTEM },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    tiles.length > 1
                      ? `${READ_IMAGE_USER}\n(This is part ${readings.length + 1} of ${tiles.length} of one tall screenshot.)`
                      : READ_IMAGE_USER,
                },
                { type: 'image_url', image_url: { url: tile.dataUrl } },
              ],
            },
          ],
        }),
      );
    }
    const worst = readings.reduce(
      (acc, r) => (QUALITY_RANK[r.quality] > QUALITY_RANK[acc] ? r.quality : acc),
      'good' as ModelImageReading['quality'],
    );
    const allUnreadable = readings.every((r) => r.quality === 'unreadable' || !r.text.trim());
    return {
      text: mergeTileTexts(readings.map((r) => r.text)),
      quality: allUnreadable ? 'unreadable' : worst === 'unreadable' ? 'poor' : worst,
      unclear: readings.flatMap((r) => r.unclear),
    } satisfies ModelImageReading;
  }

  async readIdentifiers(bytes: Uint8Array, _mime: ImageMime, signal: AbortSignal) {
    const tiles = await prepareImageTiles(bytes, { maxInlineBytes: this.opts.maxInlineBytes });
    const merged: ModelIdentifierReading = {
      registrationNumbers: [],
      upiIds: [],
      phoneNumbers: [],
      links: [],
    };
    for (const tile of tiles) {
      const r = await this.client.chatJson({
        model: this.modelId,
        schema: ModelIdentifierReading,
        maxTokens: 800,
        signal,
        attemptTimeoutMs: ATTEMPT_TIMEOUT_MS.readIdentifiers,
        hedgeAfterMs: HEDGE_AFTER_MS.readIdentifiers,
        messages: [
          { role: 'system', content: READ_IMAGE_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: READ_IDENTIFIERS_USER },
              { type: 'image_url', image_url: { url: tile.dataUrl } },
            ],
          },
        ],
      });
      merged.registrationNumbers.push(...r.registrationNumbers);
      merged.upiIds.push(...r.upiIds);
      merged.phoneNumbers.push(...r.phoneNumbers);
      merged.links.push(...r.links);
    }
    return merged;
  }
}

export class NimExtractor implements Extractor {
  constructor(
    private readonly client: NimClient,
    readonly modelId: string,
  ) {}

  async extract(transcript: string, signal: AbortSignal) {
    return this.client.chatJson({
      model: this.modelId,
      schema: ModelExtraction,
      maxTokens: 3000,
      signal,
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS.extract,
      hedgeAfterMs: HEDGE_AFTER_MS.extract,
      // The extraction schema is large; schema-constrained decoding can stall on a cold host while
      // the grammar compiles, so the schema is given in the prompt first (output is validated).
      modes: ['prompt', 'json_object', 'json_schema'],
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: extractUser(transcript.slice(0, 16_000)) },
      ],
    });
  }
}

export class NimNarrator implements Narrator {
  constructor(
    private readonly client: NimClient,
    readonly modelId: string,
  ) {}

  async narrate(facts: NarrativeFacts, signal: AbortSignal): Promise<string> {
    const out = await this.client.chatJson({
      model: this.modelId,
      schema: ModelNarrative,
      maxTokens: 400,
      temperature: 0.2,
      signal,
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS.narrate,
      hedgeAfterMs: HEDGE_AFTER_MS.narrate,
      messages: [
        { role: 'system', content: narrateSystem(facts.locale) },
        { role: 'user', content: narrateUser(facts) },
      ],
    });
    return out.text;
  }
}
