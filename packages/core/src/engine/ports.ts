import type { Locale } from '../schemas/common.js';
import type { AudioMime, ImageMime } from '../schemas/input.js';
import type {
  ModelExtraction,
  ModelIdentifierReading,
  ModelImageReading,
} from '../schemas/model-io.js';
import type { NarrativeFacts } from '../explain/narrative.js';
import type { Sources } from '../verify/ports.js';

/** Reads binary inputs into text. Implemented by the LLM adapter (vision / speech models). */
export interface Reader {
  readonly modelId: string;
  readImage(bytes: Uint8Array, mime: ImageMime, signal: AbortSignal): Promise<ModelImageReading>;
  /** Independent second read of identifiers only, used to detect OCR uncertainty. */
  readIdentifiers?(
    bytes: Uint8Array,
    mime: ImageMime,
    signal: AbortSignal,
  ): Promise<ModelIdentifierReading>;
  /** Returns null when the audio format/language is not supported. */
  transcribeAudio?(
    bytes: Uint8Array,
    mime: AudioMime,
    signal: AbortSignal,
  ): Promise<{ text: string } | null>;
}

/** Turns transcript text into structured, quote-backed extraction. */
export interface Extractor {
  readonly modelId: string;
  extract(transcript: string, signal: AbortSignal): Promise<ModelExtraction>;
}

/** Writes a short plain-language overview from already-rendered facts. Optional. */
export interface Narrator {
  readonly modelId: string;
  narrate(facts: NarrativeFacts, signal: AbortSignal): Promise<string>;
}

/** Short-lived storage for uploaded media. Media is deleted as soon as it has been read. */
export interface BlobStore {
  get(ref: string): Promise<Uint8Array | null>;
  discard(ref: string): Promise<void>;
}

export interface EngineLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export type Stage = 'reading' | 'extracting' | 'checking' | 'adjudicating' | 'explaining' | 'done';

export interface ProgressEvent {
  stage: Stage;
  /** Language-neutral details for the UI, e.g. which sources are being checked. */
  detail?: Record<string, string | number>;
}

export interface EnginePorts {
  reader: Reader | null;
  extractor: Extractor | null;
  narrator: Narrator | null;
  sources: Sources;
  blobs: BlobStore;
  clock?: () => Date;
  logger?: EngineLogger;
}

export interface EngineOptions {
  /** Per-source query timeout. */
  sourceTimeoutMs: number;
  /** Per-model-call timeout. */
  modelTimeoutMs: number;
  /** Run an independent identifier re-read on screenshots to detect OCR uncertainty. */
  ocrConsensus: boolean;
  /** Ask the narrator for a plain-language overview (falls back to a template). */
  narrative: boolean;
}

export interface RunContext {
  id: string;
  createdAt: Date;
  locale: Locale;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
  /**
   * Digit strings to remove from every transcript before extraction — e.g. the requester's own
   * phone number, which may be visible in a forwarded screenshot. Never stored, never evidence.
   */
  redactDigits?: string[];
}
