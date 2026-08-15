import {z} from 'zod';

export const IdSchema = z.string().trim().min(1);
export const FrameSchema = z.number().int().nonnegative();
export const FiniteNumberSchema = z.number().finite();
export const UnitIntervalSchema = FiniteNumberSchema.min(0).max(1);
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/u, 'Expected semantic version');
export const IsoDateTimeSchema = z.iso.datetime({offset: true});
export const ContentHashSchema = z.string().regex(
  /^[0-9a-f]{64}$/u,
  'Expected a lowercase 64-character SHA-256 hex digest',
);

export const PointSchema = z.object({
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
}).strict();

export const NormalizedPointSchema = z.object({
  x: UnitIntervalSchema,
  y: UnitIntervalSchema,
}).strict();

export const SizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const FrameRangeSchema = z.object({
  startFrame: FrameSchema,
  endFrame: FrameSchema,
}).strict().refine(
  ({startFrame, endFrame}) => endFrame > startFrame,
  {message: 'endFrame must be greater than startFrame', path: ['endFrame']},
);

export const Transform2DSchema = z.object({
  position: PointSchema,
  scale: z.object({
    x: FiniteNumberSchema.positive(),
    y: FiniteNumberSchema.positive(),
  }).strict(),
  rotation: FiniteNumberSchema,
  opacity: UnitIntervalSchema,
}).strict();

export const ProducerRefSchema = z.object({
  name: z.string().trim().min(1),
  version: SemverSchema,
}).strict();

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue};

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

export type Id = z.infer<typeof IdSchema>;
export type ContentHash = z.infer<typeof ContentHashSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Size = z.infer<typeof SizeSchema>;
export type FrameRange = z.infer<typeof FrameRangeSchema>;
export type Transform2D = z.infer<typeof Transform2DSchema>;
export type ProducerRef = z.infer<typeof ProducerRefSchema>;
