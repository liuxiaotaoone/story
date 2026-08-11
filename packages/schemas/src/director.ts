import {z} from 'zod';
import {AssetKindSchema} from './asset.js';
import {
  ContentHashSchema,
  IdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  SemverSchema,
} from './common.js';
import {DirectionSchema} from './pose-clip.js';

export const CameraIntentSchema = z.enum([
  'static',
  'slow-push-in',
  'slow-pull-out',
  'pan-left',
  'pan-right',
  'follow',
]);
export const ShotTypeSchema = z.enum(['wide', 'medium', 'close-up']);
export const HorizontalIntentSchema = z.enum(['far-left', 'left', 'center', 'right', 'far-right']);
export const DepthIntentSchema = z.enum(['background', 'midground', 'ground', 'foreground']);

export const BlockingIntentSchema = z.object({
  horizontal: HorizontalIntentSchema,
  depth: DepthIntentSchema,
  facing: DirectionSchema.optional(),
}).strict();

export const DirectorActionSchema = z.object({
  actorId: IdSchema,
  type: IdSchema,
  targetId: IdSchema.optional(),
  priority: z.enum(['required', 'optional']),
}).strict();

export const DirectorShotSchema = z.object({
  id: IdSchema,
  shotType: ShotTypeSchema,
  focusEntityId: IdSchema,
  cameraIntent: CameraIntentSchema,
  blocking: z.record(IdSchema, BlockingIntentSchema),
  actions: z.array(DirectorActionSchema),
  narration: z.string().trim().min(1).optional(),
}).strict();

export const DirectorSceneSchema = z.object({
  id: IdSchema,
  environmentIntent: z.string().trim().min(1),
  shots: z.array(DirectorShotSchema).min(1),
}).strict();

export const StoryBibleSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  styleGuideId: IdSchema,
  characters: z.array(z.object({
    id: IdSchema,
    description: z.string().trim().min(1),
    traits: z.array(z.string().trim().min(1)),
  }).strict()),
}).strict();

export const AssetRequirementSchema = z.object({
  id: IdSchema,
  kind: AssetKindSchema,
  entityType: IdSchema.optional(),
  action: IdSchema.optional(),
  direction: DirectionSchema.optional(),
  environmentIntent: z.string().trim().min(1).optional(),
  required: z.boolean(),
}).strict();

export const DirectorPlanSchema = z.object({
  schemaVersion: SemverSchema,
  projectId: IdSchema,
  storyBible: StoryBibleSchema,
  scenes: z.array(DirectorSceneSchema).min(1),
  assetRequirements: z.array(AssetRequirementSchema),
}).strict();

export const DirectorOverrideSchema = z.object({
  id: IdSchema,
  baseDirectorPlanHash: ContentHashSchema,
  targetPath: z.string().startsWith('/'),
  operation: z.enum(['replace', 'remove', 'insert']),
  value: JsonValueSchema.optional(),
  reason: z.string().trim().min(1),
  createdBy: IdSchema,
  createdAt: IsoDateTimeSchema,
}).strict().superRefine((override, context) => {
  if (override.operation === 'remove' && override.value !== undefined) {
    context.addIssue({code: 'custom', message: 'remove must not define value', path: ['value']});
  }
  if (override.operation !== 'remove' && override.value === undefined) {
    context.addIssue({code: 'custom', message: `${override.operation} requires value`, path: ['value']});
  }
});

export const EffectiveDirectorPlanSchema = z.object({
  sourceDirectorPlanHash: ContentHashSchema,
  overrideIds: z.array(IdSchema),
  effectivePlanHash: ContentHashSchema,
  plan: DirectorPlanSchema,
}).strict();

export type CameraIntent = z.infer<typeof CameraIntentSchema>;
export type DirectorAction = z.infer<typeof DirectorActionSchema>;
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;
export type AssetRequirement = z.infer<typeof AssetRequirementSchema>;
export type DirectorOverride = z.infer<typeof DirectorOverrideSchema>;
export type EffectiveDirectorPlan = z.infer<typeof EffectiveDirectorPlanSchema>;
