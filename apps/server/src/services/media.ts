import type { AudioMime, ImageMime } from '@jaanch/core';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export class MediaError extends Error {
  constructor(
    readonly code: 'unsupported_type' | 'too_large' | 'corrupt',
    message: string,
  ) {
    super(message);
  }
}

export type ValidatedMedia =
  | { kind: 'image'; mime: ImageMime; bytes: Uint8Array; width: number; height: number }
  | { kind: 'audio'; mime: AudioMime; bytes: Uint8Array };

const AUDIO_MAP: Record<string, AudioMime> = {
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/amr': 'audio/amr',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/webm': 'audio/webm',
  'video/webm': 'audio/webm',
};

const MAX_IMAGE_SIDE = 4096;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

/**
 * Validate an upload by its actual bytes (never the client-declared type). Images are decoded
 * and re-encoded, which rejects malformed files and strips EXIF/GPS metadata before anything is
 * stored or sent to a model.
 */
export async function validateMedia(
  bytes: Uint8Array,
  maxImageBytes: number,
): Promise<ValidatedMedia> {
  const type = await fileTypeFromBuffer(bytes);
  if (!type) throw new MediaError('unsupported_type', 'unrecognised file type');

  if (type.mime === 'image/jpeg' || type.mime === 'image/png' || type.mime === 'image/webp') {
    if (bytes.byteLength > maxImageBytes) throw new MediaError('too_large', 'image too large');
    try {
      const pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: 50_000_000 })
        .rotate()
        .resize({
          width: MAX_IMAGE_SIDE,
          height: MAX_IMAGE_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        });
      const out =
        type.mime === 'image/png'
          ? pipeline.png({ compressionLevel: 8 })
          : pipeline.jpeg({ quality: 90, mozjpeg: true });
      const { data, info } = await out.toBuffer({ resolveWithObject: true });
      return {
        kind: 'image',
        mime: type.mime === 'image/png' ? 'image/png' : 'image/jpeg',
        bytes: new Uint8Array(data),
        width: info.width,
        height: info.height,
      };
    } catch {
      throw new MediaError('corrupt', 'image could not be decoded');
    }
  }

  const audio = AUDIO_MAP[type.mime];
  if (audio) {
    if (bytes.byteLength > MAX_AUDIO_BYTES) throw new MediaError('too_large', 'audio too large');
    return { kind: 'audio', mime: audio, bytes };
  }
  throw new MediaError('unsupported_type', `unsupported type ${type.mime}`);
}
