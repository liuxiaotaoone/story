import {z} from 'zod';
import {FiniteNumberSchema, IdSchema} from './common.js';

export const GroundOffsetSchema = z.object({
  u: FiniteNumberSchema.min(-1).max(1),
  v: FiniteNumberSchema.min(-1).max(1),
}).strict();

export const InteractionAnchorSchema = z.object({
  id: IdSchema,
  groundOffset: GroundOffsetSchema,
}).strict();

export const ContactInteractionSchema = z.object({
  targetAnchorId: IdSchema,
  actorGroundOffset: GroundOffsetSchema.optional(),
}).strict();

export const EffectCueCapabilitySchema = z.object({
  effectType: IdSchema,
  trigger: z.literal('action-start'),
  durationFrames: z.number().int().positive(),
}).strict();

export const OwnershipTransferCapabilitySchema = z.object({
  mode: z.literal('baked'),
  timing: z.enum(['action-start', 'action-end']),
  ownerSlot: IdSchema,
  compositeSlotId: IdSchema,
}).strict();

export const ActionInteractionSchema = z.object({
  contact: ContactInteractionSchema.optional(),
  effect: EffectCueCapabilitySchema.optional(),
  ownership: OwnershipTransferCapabilitySchema.optional(),
}).strict().refine(
  interaction => interaction.contact !== undefined || interaction.effect !== undefined || interaction.ownership !== undefined,
  {message: 'Action interaction must declare contact, effect or ownership'},
);

export type GroundOffset = z.infer<typeof GroundOffsetSchema>;
export type InteractionAnchor = z.infer<typeof InteractionAnchorSchema>;
export type ActionInteraction = z.infer<typeof ActionInteractionSchema>;
