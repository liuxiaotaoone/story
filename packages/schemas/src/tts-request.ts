import {z} from 'zod';
import {ContentHashSchema, IdSchema} from './common.js';

export const NarrationSegmentSchema = z.object({
  id: IdSchema,
  narrationIntentId: IdSchema,
  shotId: IdSchema,
  sequence: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
  language: z.string().trim().min(1),
}).strict();

export const TtsRequestSchema = z.object({
  id: IdSchema,
  segmentId: IdSchema,
  text: z.string().trim().min(1),
  voiceId: IdSchema,
  speed: z.number().finite().min(0.8).max(1.2),
  language: z.string().trim().min(1),
  inputHash: ContentHashSchema,
}).strict();

// Compatibility name for the earlier two-stage compiler contract.
export const TtsRequirementSchema = TtsRequestSchema;

export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;
export type TtsRequest = z.infer<typeof TtsRequestSchema>;
export type TtsRequirement = TtsRequest;
