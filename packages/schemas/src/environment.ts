import {z} from 'zod';
import {
  FiniteNumberSchema,
  IdSchema,
  NormalizedPointSchema,
  PointSchema,
  SizeSchema,
  Transform2DSchema,
  UnitIntervalSchema,
} from './common.js';

export const RenderLayerNameSchema = z.enum([
  'far',
  'mid',
  'ground',
  'characters',
  'foreground',
  'effects',
  'overlay',
]);

export const RENDER_LAYER_ORDER = {
  far: 0,
  mid: 100,
  ground: 200,
  characters: 300,
  foreground: 400,
  effects: 500,
  overlay: 600,
} as const satisfies Record<z.infer<typeof RenderLayerNameSchema>, number>;

export const PolygonSchema = z.object({
  points: z.array(NormalizedPointSchema).min(3),
}).strict();

export const EnvironmentLayerSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  renderLayer: RenderLayerNameSchema,
  zIndex: z.number().int(),
  parallaxFactor: FiniteNumberSchema.nonnegative(),
  transform: Transform2DSchema,
}).strict();

export const GroundSurfaceSchema = z.object({
  farLeft: NormalizedPointSchema,
  farRight: NormalizedPointSchema,
  nearLeft: NormalizedPointSchema,
  nearRight: NormalizedPointSchema,
  farScale: FiniteNumberSchema.positive(),
  nearScale: FiniteNumberSchema.positive(),
  depthEasing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']),
  walkableZones: z.array(PolygonSchema),
}).strict().refine(
  ({farScale, nearScale}) => nearScale >= farScale,
  {message: 'nearScale must be greater than or equal to farScale', path: ['nearScale']},
);

export const EnvironmentDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1),
  referenceResolution: SizeSchema,
  layers: z.array(EnvironmentLayerSchema),
  ground: GroundSurfaceSchema,
  occlusionZones: z.array(PolygonSchema),
  safeSubtitleZone: PolygonSchema.optional(),
}).strict();

export const GroundPointSchema = z.object({
  u: UnitIntervalSchema,
  v: UnitIntervalSchema,
}).strict();

export const GroundProjectionResultSchema = z.object({
  worldFootPosition: PointSchema,
  perspectiveScale: FiniteNumberSchema.positive(),
  depth: UnitIntervalSchema,
}).strict();

export const CameraStateSchema = z.object({
  position: PointSchema,
  zoom: FiniteNumberSchema.positive(),
  rotation: FiniteNumberSchema,
}).strict();

export type RenderLayerName = z.infer<typeof RenderLayerNameSchema>;
export type EnvironmentDefinition = z.infer<typeof EnvironmentDefinitionSchema>;
export type GroundPoint = z.infer<typeof GroundPointSchema>;
export type GroundProjectionResult = z.infer<typeof GroundProjectionResultSchema>;
export type CameraState = z.infer<typeof CameraStateSchema>;
