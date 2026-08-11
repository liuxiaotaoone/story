import {z} from 'zod';
import {AttachmentModeSchema} from './attachment.js';
import {IdSchema, SemverSchema} from './common.js';
import {CameraIntentSchema, DepthIntentSchema, ShotTypeSchema} from './director.js';
import {DirectionSchema} from './pose-clip.js';

export const ActionCapabilitySchema = z.object({
  action: IdSchema,
  requiredPoseClips: z.array(IdSchema),
  targetTypes: z.array(IdSchema).optional(),
  minDurationFrames: z.number().int().nonnegative(),
  supportsDirections: z.array(DirectionSchema).min(1),
  attachmentMode: AttachmentModeSchema.optional(),
}).strict();

export const EntityCapabilitySchema = z.object({
  entityType: IdSchema,
  poseClips: z.array(IdSchema),
  actions: z.array(ActionCapabilitySchema),
  attachmentSlots: z.array(IdSchema),
}).strict();

export const CameraCapabilitySchema = z.object({
  intent: CameraIntentSchema,
  minDurationFrames: z.number().int().nonnegative(),
  allowedShotTypes: z.array(ShotTypeSchema).min(1),
}).strict();

export const EnvironmentCapabilitySchema = z.object({
  environmentId: IdSchema,
  allowedEntityTypes: z.array(IdSchema),
  supportedDepthIntents: z.array(DepthIntentSchema),
}).strict();

export const FallbackRuleSchema = z.object({
  unsupportedAction: IdSchema,
  replacementActions: z.array(IdSchema).min(1),
  reason: z.string().trim().min(1),
}).strict();

export const CapabilityCatalogSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  catalogVersion: SemverSchema,
  entityCapabilities: z.array(EntityCapabilitySchema),
  cameraCapabilities: z.array(CameraCapabilitySchema),
  environmentCapabilities: z.array(EnvironmentCapabilitySchema),
  fallbackRules: z.array(FallbackRuleSchema),
}).strict();

export type CapabilityCatalog = z.infer<typeof CapabilityCatalogSchema>;
