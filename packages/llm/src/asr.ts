import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { AudioMime } from '@jaanch/core';
import type { LlmLogger } from './nim.js';

/** NVIDIA-hosted Riva ASR functions (function ids from build.nvidia.com, verified 2026-10-04). */
export const ASR_FUNCTIONS: Record<string, { functionId: string; languageCode: string }> = {
  'openai/whisper-large-v3': {
    functionId: 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d',
    languageCode: 'multi',
  },
  'nvidia/canary-1b-asr': {
    functionId: 'b0e8b4a5-217c-40b7-9b96-17d84e666317',
    languageCode: 'hi-IN',
  },
};

function protoDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.RIVA_PROTO_DIR,
    path.resolve(here, '../protos'),
    path.resolve(here, 'protos'),
    path.resolve(process.cwd(), 'packages/llm/protos'),
    path.resolve(process.cwd(), '../../packages/llm/protos'),
  ].filter((c): c is string => !!c);
  const dir = candidates.find((c) => existsSync(path.join(c, 'riva/proto/riva_asr.proto')));
  if (!dir) throw new Error('Riva proto files not found (set RIVA_PROTO_DIR)');
  return dir;
}

interface RecognizeResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
}
type RecognizeFn = (
  req: unknown,
  md: grpc.Metadata,
  opts: grpc.CallOptions,
  cb: (err: grpc.ServiceError | null, res?: RecognizeResponse) => void,
) => void;

/** Transcode any audio to 16 kHz mono 16-bit PCM WAV with ffmpeg (if installed). */
export async function toWav16k(
  bytes: Uint8Array,
  ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg',
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) =>
      resolve(code === 0 && chunks.length ? new Uint8Array(Buffer.concat(chunks)) : null),
    );
    proc.stdin.on('error', () => undefined);
    proc.stdin.end(Buffer.from(bytes));
  });
}

/**
 * Speech-to-text through NVIDIA's hosted Riva gRPC endpoint. WhatsApp voice notes (Ogg/Opus) are
 * sent as-is; other formats (and Ogg if rejected) are transcoded to WAV with ffmpeg when available.
 * Returns null when the audio cannot be processed — the report then says it couldn't be checked.
 */
export class RivaAsr {
  private client: grpc.Client | null = null;

  constructor(
    private readonly o: {
      apiKey: string;
      model: string;
      endpoint?: string;
      timeoutMs: number;
      logger?: LlmLogger;
    },
  ) {}

  get modelId(): string {
    return this.o.model;
  }

  private recognizeFn(): RecognizeFn {
    if (!this.client) {
      const def = protoLoader.loadSync('riva/proto/riva_asr.proto', {
        includeDirs: [protoDir()],
        keepCase: true,
        enums: String,
        longs: String,
        defaults: true,
      });
      const pkg = grpc.loadPackageDefinition(def) as unknown as {
        nvidia: {
          riva: {
            asr: {
              RivaSpeechRecognition: new (
                addr: string,
                creds: grpc.ChannelCredentials,
              ) => grpc.Client;
            };
          };
        };
      };
      this.client = new pkg.nvidia.riva.asr.RivaSpeechRecognition(
        this.o.endpoint ?? 'grpc.nvcf.nvidia.com:443',
        grpc.credentials.createSsl(),
      );
    }
    const c = this.client as unknown as { Recognize: RecognizeFn };
    return c.Recognize.bind(this.client);
  }

  private async recognize(
    audio: Uint8Array,
    encoding: 'OGGOPUS' | 'LINEAR_PCM',
    signal: AbortSignal,
  ): Promise<string> {
    const fn = ASR_FUNCTIONS[this.o.model];
    if (!fn) throw new Error(`no hosted function id for ASR model ${this.o.model}`);
    const md = new grpc.Metadata();
    md.set('function-id', fn.functionId);
    md.set('authorization', `Bearer ${this.o.apiKey}`);
    const recognize = this.recognizeFn();
    return new Promise((resolve, reject) => {
      const call = recognize(
        {
          config: {
            encoding,
            ...(encoding === 'LINEAR_PCM'
              ? { sample_rate_hertz: 16000, audio_channel_count: 1 }
              : {}),
            language_code: fn.languageCode,
            max_alternatives: 1,
            enable_automatic_punctuation: true,
          },
          audio: Buffer.from(audio),
        },
        md,
        { deadline: Date.now() + this.o.timeoutMs },
        (err, res) => {
          if (err) return reject(err);
          resolve(
            (res?.results ?? [])
              .map((r) => r.alternatives?.[0]?.transcript ?? '')
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim(),
          );
        },
      ) as unknown as { cancel?: () => void } | undefined;
      signal.addEventListener('abort', () => call?.cancel?.(), { once: true });
    });
  }

  async transcribe(
    bytes: Uint8Array,
    mime: AudioMime,
    signal: AbortSignal,
  ): Promise<{ text: string } | null> {
    if (mime === 'audio/ogg') {
      try {
        const text = await this.recognize(bytes, 'OGGOPUS', signal);
        if (text) return { text };
      } catch (err) {
        this.o.logger?.warn({ err: String(err) }, 'ogg/opus rejected by ASR; trying WAV transcode');
      }
    }
    const wav = await toWav16k(bytes);
    if (!wav) return null;
    const text = await this.recognize(wav, 'LINEAR_PCM', signal);
    return text ? { text } : null;
  }

  close(): void {
    this.client?.close();
  }
}
