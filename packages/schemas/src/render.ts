import {z} from 'zod';
import {AssetManifestSchema} from './asset.js';
import {OwnerRefSchema} from './attachment.js';
import {
  ContentHashSchema,
  FrameSchema,
  IdSchema,
  IsoDateTimeSchema,
  PointSchema,
  SemverSchema,
  SizeSchema,
  Transform2DSchema,
  UnitIntervalSchema,
} from './common.js';
import {CompileWarningSchema} from './compiler.js';
import {EntityDefinitionSchema, EntityInstanceSchema} from './entity.js';
import {
  CameraStateSchema,
  EnvironmentDefinitionSchema,
  RenderLayerNameSchema,
} from './environment.js';
import {PoseClipSchema} from './pose-clip.js';
import {TimelineSchema} from './timeline.js';

export const ProjectSpecSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1),
  fps: z.literal(30),
  resolution: SizeSchema.refine(
    ({width, height}) => width === 1280 && height === 720,
    {message: 'MVP resolution must be 1280x720'},
  ),
  sampleRate: z.literal(48_000),
  seed: z.number().int(),
  styleGuideId: IdSchema,
  capabilityCatalogVersion: SemverSchema,
}).strict();

export const CompileProvenanceSchema = z.object({
  compilerVersion: SemverSchema,
  sourceDirectorPlanHash: ContentHashSchema,
  effectiveDirectorPlanHash: ContentHashSchema,
  directorOverrideIds: z.array(IdSchema),
  capabilityCatalogVersion: SemverSchema,
  compiledAt: IsoDateTimeSchema,
  warnings: z.array(CompileWarningSchema),
}).strict();

export const RenderPlanSchema = z.object({
  schemaVersion: SemverSchema,
  project: ProjectSpecSchema,
  assets: AssetManifestSchema,
  environments: z.array(EnvironmentDefinitionSchema),
  entities: z.array(EntityDefinitionSchema),
  instances: z.array(EntityInstanceSchema),
  poseClips: z.array(PoseClipSchema),
  timeline: TimelineSchema,
  provenance: CompileProvenanceSchema,
}).strict();

export const PoseTransitionRenderRefSchema = z.object({
  transitionId: IdSchema,
  role: z.enum(['from', 'to']),
}).strict();

export const SpriteRenderStateSchema = z.object({
  renderId: IdSchema,
  entityId: IdSchema.optional(),
  assetId: IdSchema,
  transform: Transform2DSchema,
  anchor: PointSchema,
  renderLayer: RenderLayerNameSchema,
  zIndex: z.number().int(),
  depth: z.number().finite(),
  stableSortKey: z.string().min(1),
  visible: z.boolean(),
  owner: OwnerRefSchema,
  poseTransition: PoseTransitionRenderRefSchema.optional(),
}).strict();

export const EffectRenderStateSchema = z.object({
  effectId: IdSchema,
  effectType: IdSchema,
  assetId: IdSchema.optional(),
  transform: Transform2DSchema.optional(),
  progress: UnitIntervalSchema,
  parameters: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])).optional(),
}).strict();

export const SubtitleRenderStateSchema = z.object({
  cueId: IdSchema,
  text: z.string(),
  styleId: IdSchema,
  opacity: UnitIntervalSchema,
}).strict();

export const RenderStateSchema = z.object({
  frame: FrameSchema,
  shotId: IdSchema,
  environmentId: IdSchema,
  camera: CameraStateSchema,
  sprites: z.array(SpriteRenderStateSchema),
  effects: z.array(EffectRenderStateSchema),
  subtitle: SubtitleRenderStateSchema.optional(),
}).strict().superRefine((state, context) => {
  const sortKeys = new Map<string, number>();
  for (const [index, sprite] of state.sprites.entries()) {
    const previous = sortKeys.get(sprite.stableSortKey);
    if (previous !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate stableSortKey also used by sprite ${previous}`,
        path: ['sprites', index, 'stableSortKey'],
      });
    }
    sortKeys.set(sprite.stableSortKey, index);
  }

  const visibleByEntity = new Map<string, Array<{index: number; sprite: z.infer<typeof SpriteRenderStateSchema>}>>();
  for (const [index, sprite] of state.sprites.entries()) {
    if (!sprite.visible || sprite.entityId === undefined) continue;
    const entries = visibleByEntity.get(sprite.entityId) ?? [];
    entries.push({index, sprite});
    visibleByEntity.set(sprite.entityId, entries);
  }

  for (const [entityId, entries] of visibleByEntity) {
    if (entries.length <= 1) continue;
    if (entries.length !== 2) {
      context.addIssue({code: 'custom', message: `Entity ${entityId} has more than two visible sprites`, path: ['sprites']});
      continue;
    }
    const [first, second] = entries;
    if (first === undefined || second === undefined) continue;
    const firstTransition = first.sprite.poseTransition;
    const secondTransition = second.sprite.poseTransition;
    const legalCrossfade = firstTransition !== undefined
      && secondTransition !== undefined
      && firstTransition.transitionId === secondTransition.transitionId
      && new Set([firstTransition.role, secondTransition.role]).size === 2
      && Math.abs(first.sprite.transform.opacity + second.sprite.transform.opacity - 1) <= 1e-6;
    if (!legalCrossfade) {
      context.addIssue({
        code: 'custom',
        message: `Entity ${entityId} has duplicate visible sprites outside a legal crossfade`,
        path: ['sprites', second.index],
      });
    }
  }
});

export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;
export type RenderPlan = z.infer<typeof RenderPlanSchema>;
export type SpriteRenderState = z.infer<typeof SpriteRenderStateSchema>;
export type RenderState = z.infer<typeof RenderStateSchema>;
