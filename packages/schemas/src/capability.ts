import {z} from 'zod';
import {AttachmentModeSchema} from './attachment.js';
import {IdSchema, SemverSchema} from './common.js';
import {CameraIntentSchema, DepthIntentSchema, ShotTypeSchema} from './director-plan.js';
import {DirectionSchema} from './pose-clip.js';

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) context.addIssue({code: 'custom', message: `Duplicate ${path} value: ${value}`, path: [path, index]});
    seen.add(value);
  }
}

export const ActionCapabilitySchema = z.object({
  action: IdSchema,
  requiredPoseClips: z.array(IdSchema),
  targetTypes: z.array(IdSchema).optional(),
  minDurationFrames: z.number().int().positive(),
  supportsDirections: z.array(DirectionSchema).min(1),
  attachmentMode: AttachmentModeSchema.optional(),
}).strict().superRefine((action, context) => {
  addDuplicateIssues(action.requiredPoseClips, context, 'requiredPoseClips');
  addDuplicateIssues(action.supportsDirections, context, 'supportsDirections');
  if (action.targetTypes !== undefined) addDuplicateIssues(action.targetTypes, context, 'targetTypes');
});

export const EntityCapabilitySchema = z.object({
  entityType: IdSchema,
  visualAssetKind: z.enum(['character-frame', 'animal-frame']),
  poseClips: z.array(IdSchema),
  actions: z.array(ActionCapabilitySchema),
  attachmentSlots: z.array(IdSchema),
}).strict().superRefine((entity, context) => {
  addDuplicateIssues(entity.poseClips, context, 'poseClips');
  addDuplicateIssues(entity.attachmentSlots, context, 'attachmentSlots');
  const actions = new Set<string>();
  for (const [index, action] of entity.actions.entries()) {
    if (actions.has(action.action)) context.addIssue({code: 'custom', message: `Duplicate action capability: ${action.action}`, path: ['actions', index, 'action']});
    actions.add(action.action);
  }
});

export const CameraCapabilitySchema = z.object({
  intent: CameraIntentSchema,
  minDurationFrames: z.number().int().nonnegative(),
  allowedShotTypes: z.array(ShotTypeSchema).min(1),
}).strict().superRefine((camera, context) => {
  addDuplicateIssues(camera.allowedShotTypes, context, 'allowedShotTypes');
});

export const EnvironmentCapabilitySchema = z.object({
  environmentId: IdSchema,
  allowedEntityTypes: z.array(IdSchema),
  supportedDepthIntents: z.array(DepthIntentSchema),
}).strict().superRefine((environment, context) => {
  addDuplicateIssues(environment.allowedEntityTypes, context, 'allowedEntityTypes');
  addDuplicateIssues(environment.supportedDepthIntents, context, 'supportedDepthIntents');
});

export const FallbackRuleSchema = z.object({
  unsupportedAction: IdSchema,
  replacementActions: z.array(IdSchema).min(1),
  reason: z.string().trim().min(1),
}).strict().superRefine((fallback, context) => {
  addDuplicateIssues(fallback.replacementActions, context, 'replacementActions');
});

export const CapabilityCatalogSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  catalogVersion: SemverSchema,
  entityCapabilities: z.array(EntityCapabilitySchema),
  cameraCapabilities: z.array(CameraCapabilitySchema),
  environmentCapabilities: z.array(EnvironmentCapabilitySchema),
  fallbackRules: z.array(FallbackRuleSchema),
}).strict().superRefine((catalog, context) => {
  const uniqueBy = <T>(values: readonly T[], keyOf: (value: T) => string, path: string): void => {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      const key = keyOf(value);
      if (seen.has(key)) context.addIssue({code: 'custom', message: `Duplicate ${path} key: ${key}`, path: [path, index]});
      seen.add(key);
    }
  };
  uniqueBy(catalog.entityCapabilities, value => value.entityType, 'entityCapabilities');
  uniqueBy(catalog.cameraCapabilities, value => value.intent, 'cameraCapabilities');
  uniqueBy(catalog.environmentCapabilities, value => value.environmentId, 'environmentCapabilities');
  uniqueBy(catalog.fallbackRules, value => value.unsupportedAction, 'fallbackRules');
});

export type CapabilityCatalog = z.infer<typeof CapabilityCatalogSchema>;
export type ActionCapability = z.infer<typeof ActionCapabilitySchema>;
export type EntityCapability = z.infer<typeof EntityCapabilitySchema>;
export type CameraCapability = z.infer<typeof CameraCapabilitySchema>;
export type EnvironmentCapability = z.infer<typeof EnvironmentCapabilitySchema>;
export type FallbackRule = z.infer<typeof FallbackRuleSchema>;
