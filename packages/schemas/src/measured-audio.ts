import {z} from 'zod';
import {ContentHashSchema, IdSchema, ProducerRefSchema} from './common.js';

export const MeasuredAudioSchema = z.object({
  requestId: IdSchema,
  sourceTtsRequestHash: ContentHashSchema,
  assetId: IdSchema,
  sampleRate: z.number().int().positive(),
  sampleFrameCount: z.number().int().positive(),
  channels: z.number().int().positive(),
  contentHash: ContentHashSchema,
  measurementProducer: ProducerRefSchema,
}).strict();

export function measuredAudioDurationSeconds(audio: z.infer<typeof MeasuredAudioSchema>): number {
  return audio.sampleFrameCount / audio.sampleRate;
}

export type MeasuredAudio = z.infer<typeof MeasuredAudioSchema>;
