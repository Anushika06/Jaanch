import { z } from 'zod';
import { Channel, Locale } from './common.js';

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AUDIO_MIME_TYPES = [
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'audio/wav',
  'audio/webm',
] as const;

export const ImageMime = z.enum(IMAGE_MIME_TYPES);
export type ImageMime = z.infer<typeof ImageMime>;
export const AudioMime = z.enum(AUDIO_MIME_TYPES);
export type AudioMime = z.infer<typeof AudioMime>;

/**
 * One piece of user input. Binary media is never embedded in the investigation record; it is
 * referenced through an opaque `blobRef` that the hosting app resolves from short-lived storage
 * and deletes as soon as it has been read.
 */
export const InputPart = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1).max(20_000),
  }),
  z.object({
    kind: z.literal('image'),
    blobRef: z.string().min(1),
    mime: ImageMime,
    bytes: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('audio'),
    blobRef: z.string().min(1),
    mime: AudioMime,
    bytes: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('url'),
    url: z.string().min(4).max(2_048),
  }),
]);
export type InputPart = z.infer<typeof InputPart>;

export const InvestigationInput = z.object({
  channel: Channel,
  locale: Locale,
  parts: z.array(InputPart).min(1).max(12),
});
export type InvestigationInput = z.infer<typeof InvestigationInput>;
