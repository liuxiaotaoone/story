import {z} from 'zod';
import {
  ContentHashSchema,
  IdSchema,
  JsonValueSchema,
  ProducerRefSchema,
} from './common.js';
import {canonicalHash} from './hash.js';

export const ContinuityMetricNameSchema = z.enum([
  'identityConsistency',
  'scaleConsistency',
  'canvasConsistency',
  'bodyProportion',
  'footContact',
  'anchorMovement',
  'silhouetteContinuity',
  'loopClosure',
]);

export const ContinuityMetricStatusSchema = z.enum([
  'passed',
  'warning',
  'failed',
  'not-applicable',
]);

export const ContinuityThresholdSchema = z.object({
  warning: z.number().finite().nonnegative(),
  failure: z.number().finite().nonnegative(),
}).strict().superRefine((threshold, context) => {
  if (threshold.warning > threshold.failure) context.addIssue({
    code: 'custom',
    message: 'Continuity warning threshold must not exceed failure threshold',
    path: ['warning'],
  });
});

export const PoseClipContinuityThresholdsSchema = z.object({
  identityConsistency: ContinuityThresholdSchema,
  scaleConsistency: ContinuityThresholdSchema,
  canvasConsistency: ContinuityThresholdSchema,
  bodyProportion: ContinuityThresholdSchema,
  footContact: ContinuityThresholdSchema,
  anchorMovement: ContinuityThresholdSchema,
  silhouetteContinuity: ContinuityThresholdSchema,
  loopClosure: ContinuityThresholdSchema,
}).strict();

export const PoseClipContinuityExtractorModelSchema = z.object({
  modelId: IdSchema,
  contentHash: ContentHashSchema,
}).strict();

const PoseClipContinuityFeatureExtractorSpecPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  extractor: ProducerRefSchema,
  model: PoseClipContinuityExtractorModelSchema.optional(),
  config: JsonValueSchema,
} as const;

export const PoseClipContinuityFeatureExtractorSpecPayloadSchema = z.object(
  PoseClipContinuityFeatureExtractorSpecPayloadShape,
).strict();

export const PoseClipContinuityFeatureExtractorSpecSchema = z.object({
  ...PoseClipContinuityFeatureExtractorSpecPayloadShape,
  extractorSpecHash: ContentHashSchema,
}).strict();

const PoseClipContinuityQaSpecPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  evaluator: ProducerRefSchema,
  featureExtractor: PoseClipContinuityFeatureExtractorSpecSchema,
  thresholds: PoseClipContinuityThresholdsSchema,
} as const;

export const PoseClipContinuityQaSpecPayloadSchema = z.object(
  PoseClipContinuityQaSpecPayloadShape,
).strict();

export const PoseClipContinuityQaSpecSchema = z.object({
  ...PoseClipContinuityQaSpecPayloadShape,
  continuityQaSpecHash: ContentHashSchema,
}).strict();

const UnitIntervalSchema = z.number().finite().min(0).max(1);

export const NormalizedSubjectBoundsSchema = z.object({
  x: UnitIntervalSchema,
  y: UnitIntervalSchema,
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict().superRefine((bounds, context) => {
  if (bounds.x + bounds.width > 1) context.addIssue({
    code: 'custom', message: 'Subject bounds exceed normalized canvas width', path: ['width'],
  });
  if (bounds.y + bounds.height > 1) context.addIssue({
    code: 'custom', message: 'Subject bounds exceed normalized canvas height', path: ['height'],
  });
});

const FeatureVectorSchema = z.array(z.number().finite()).min(1);

export const PoseClipContinuityFrameFeaturesSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  sourceContentHash: ContentHashSchema,
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  subjectBounds: NormalizedSubjectBoundsSchema,
  identityEmbedding: FeatureVectorSchema,
  bodyProportions: FeatureVectorSchema,
  silhouetteEmbedding: FeatureVectorSchema,
}).strict();

export const ContinuityFramePairSchema = z.object({
  fromFrame: z.number().int().nonnegative(),
  toFrame: z.number().int().nonnegative(),
}).strict();

export const ContinuityMetricResultSchema = z.object({
  status: ContinuityMetricStatusSchema,
  maxDelta: z.number().finite().nonnegative(),
  thresholds: ContinuityThresholdSchema,
  worstPair: ContinuityFramePairSchema.optional(),
  worstFrame: z.number().int().nonnegative().optional(),
}).strict().superRefine((metric, context) => {
  if (metric.status === 'not-applicable' && (metric.worstPair !== undefined || metric.worstFrame !== undefined)) {
    context.addIssue({code: 'custom', message: 'Not-applicable metric cannot identify a worst frame'});
  }
  if (metric.status === 'not-applicable') {
    if (metric.maxDelta !== 0) context.addIssue({
      code: 'custom', message: 'Not-applicable metric requires maxDelta=0', path: ['maxDelta'],
    });
    return;
  }
  const expected = metric.maxDelta > metric.thresholds.failure
    ? 'failed'
    : metric.maxDelta > metric.thresholds.warning ? 'warning' : 'passed';
  if (metric.status !== expected) context.addIssue({
    code: 'custom', message: `Metric status must be ${expected} for maxDelta`, path: ['status'],
  });
});

export const PoseClipContinuityMetricsSchema = z.object({
  identityConsistency: ContinuityMetricResultSchema,
  scaleConsistency: ContinuityMetricResultSchema,
  canvasConsistency: ContinuityMetricResultSchema,
  bodyProportion: ContinuityMetricResultSchema,
  footContact: ContinuityMetricResultSchema,
  anchorMovement: ContinuityMetricResultSchema,
  silhouetteContinuity: ContinuityMetricResultSchema,
  loopClosure: ContinuityMetricResultSchema,
}).strict();

export const PoseClipContinuityDiagnosticSchema = z.object({
  code: IdSchema,
  severity: z.enum(['warning', 'error']),
  message: z.string().trim().min(1),
  metric: ContinuityMetricNameSchema,
  frameIndex: z.number().int().nonnegative().optional(),
  comparedFrameIndex: z.number().int().nonnegative().optional(),
}).strict();

const PoseClipContinuityEvaluationPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  continuityQaSpecHash: ContentHashSchema,
  frameResultHashes: z.array(ContentHashSchema).min(2),
  loop: z.boolean(),
  metrics: PoseClipContinuityMetricsSchema,
  continuity: z.enum(['passed', 'warning', 'failed']),
  automatedReady: z.boolean(),
  diagnostics: z.array(PoseClipContinuityDiagnosticSchema),
} as const;

function refineContinuityEvaluation(
  evaluation: z.output<z.ZodObject<typeof PoseClipContinuityEvaluationPayloadShape>>,
  context: z.RefinementCtx,
): void {
  if (evaluation.loop && evaluation.metrics.loopClosure.status === 'not-applicable') context.addIssue({
    code: 'custom', message: 'Loop continuity evaluation requires loopClosure', path: ['metrics', 'loopClosure'],
  });
  if (!evaluation.loop && evaluation.metrics.loopClosure.status !== 'not-applicable') context.addIssue({
    code: 'custom', message: 'Non-loop continuity evaluation requires not-applicable loopClosure',
    path: ['metrics', 'loopClosure'],
  });
  for (const metric of [
    'identityConsistency',
    'scaleConsistency',
    'canvasConsistency',
    'bodyProportion',
    'anchorMovement',
    'silhouetteContinuity',
  ] as const) {
    if (evaluation.metrics[metric].status === 'not-applicable') context.addIssue({
      code: 'custom', message: `${metric} cannot be not-applicable`, path: ['metrics', metric, 'status'],
    });
  }
  const evaluated = Object.values(evaluation.metrics).filter(({status}) => status !== 'not-applicable');
  const expectedContinuity = evaluated.some(({status}) => status === 'failed')
    ? 'failed'
    : evaluated.some(({status}) => status === 'warning') ? 'warning' : 'passed';
  if (evaluation.continuity !== expectedContinuity) context.addIssue({
    code: 'custom', message: `Continuity aggregate must be ${expectedContinuity}`, path: ['continuity'],
  });
  if (evaluation.automatedReady && evaluation.continuity !== 'passed') context.addIssue({
    code: 'custom', message: 'automatedReady requires passed continuity', path: ['automatedReady'],
  });
}

export const PoseClipContinuityEvaluationPayloadSchema = z.object(
  PoseClipContinuityEvaluationPayloadShape,
).strict().superRefine(refineContinuityEvaluation);

export const PoseClipContinuityEvaluationSchema = z.object({
  ...PoseClipContinuityEvaluationPayloadShape,
  evaluationHash: ContentHashSchema,
}).strict().superRefine(refineContinuityEvaluation);

export class PoseClipContinuityIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipContinuityIntegrityError';
  }
}

export async function hashPoseClipContinuityFeatureExtractorSpecPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-continuity-feature-extractor-spec-v1',
    PoseClipContinuityFeatureExtractorSpecPayloadSchema.parse(input),
  );
}

export async function createPoseClipContinuityFeatureExtractorSpec(input: unknown): Promise<PoseClipContinuityFeatureExtractorSpec> {
  const payload = PoseClipContinuityFeatureExtractorSpecPayloadSchema.parse(input);
  return PoseClipContinuityFeatureExtractorSpecSchema.parse({
    ...payload,
    extractorSpecHash: await hashPoseClipContinuityFeatureExtractorSpecPayload(payload),
  });
}

export async function assertPoseClipContinuityFeatureExtractorSpecIntegrity(input: unknown): Promise<PoseClipContinuityFeatureExtractorSpec> {
  const spec = PoseClipContinuityFeatureExtractorSpecSchema.parse(input);
  const {extractorSpecHash: _extractorSpecHash, ...payload} = spec;
  if (await hashPoseClipContinuityFeatureExtractorSpecPayload(payload) !== spec.extractorSpecHash) {
    throw new PoseClipContinuityIntegrityError('CONTINUITY_EXTRACTOR_SPEC_HASH_MISMATCH', spec.extractor.name);
  }
  return spec;
}

export async function hashPoseClipContinuityQaSpecPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-continuity-qa-spec-v1',
    PoseClipContinuityQaSpecPayloadSchema.parse(input),
  );
}

export async function createPoseClipContinuityQaSpec(input: unknown): Promise<PoseClipContinuityQaSpec> {
  const payload = PoseClipContinuityQaSpecPayloadSchema.parse(input);
  await assertPoseClipContinuityFeatureExtractorSpecIntegrity(payload.featureExtractor);
  return PoseClipContinuityQaSpecSchema.parse({
    ...payload,
    continuityQaSpecHash: await hashPoseClipContinuityQaSpecPayload(payload),
  });
}

export async function assertPoseClipContinuityQaSpecIntegrity(input: unknown): Promise<PoseClipContinuityQaSpec> {
  const spec = PoseClipContinuityQaSpecSchema.parse(input);
  await assertPoseClipContinuityFeatureExtractorSpecIntegrity(spec.featureExtractor);
  const {continuityQaSpecHash: _continuityQaSpecHash, ...payload} = spec;
  if (await hashPoseClipContinuityQaSpecPayload(payload) !== spec.continuityQaSpecHash) {
    throw new PoseClipContinuityIntegrityError('CONTINUITY_QA_SPEC_HASH_MISMATCH', spec.evaluator.name);
  }
  return spec;
}

export async function hashPoseClipContinuityEvaluationPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-continuity-evaluation-v1',
    PoseClipContinuityEvaluationPayloadSchema.parse(input),
  );
}

export async function assertPoseClipContinuityEvaluationIntegrity(input: unknown): Promise<PoseClipContinuityEvaluation> {
  const evaluation = PoseClipContinuityEvaluationSchema.parse(input);
  const {evaluationHash: _evaluationHash, ...payload} = evaluation;
  if (await hashPoseClipContinuityEvaluationPayload(payload) !== evaluation.evaluationHash) {
    throw new PoseClipContinuityIntegrityError('CONTINUITY_EVALUATION_HASH_MISMATCH', evaluation.continuityQaSpecHash);
  }
  return evaluation;
}

export type ContinuityMetricName = z.infer<typeof ContinuityMetricNameSchema>;
export type ContinuityMetricStatus = z.infer<typeof ContinuityMetricStatusSchema>;
export type ContinuityThreshold = z.infer<typeof ContinuityThresholdSchema>;
export type PoseClipContinuityThresholds = z.infer<typeof PoseClipContinuityThresholdsSchema>;
export type PoseClipContinuityFeatureExtractorSpec = z.infer<typeof PoseClipContinuityFeatureExtractorSpecSchema>;
export type PoseClipContinuityQaSpec = z.infer<typeof PoseClipContinuityQaSpecSchema>;
export type PoseClipContinuityFrameFeatures = z.infer<typeof PoseClipContinuityFrameFeaturesSchema>;
export type ContinuityMetricResult = z.infer<typeof ContinuityMetricResultSchema>;
export type PoseClipContinuityMetrics = z.infer<typeof PoseClipContinuityMetricsSchema>;
export type PoseClipContinuityDiagnostic = z.infer<typeof PoseClipContinuityDiagnosticSchema>;
export type PoseClipContinuityEvaluationPayload = z.infer<typeof PoseClipContinuityEvaluationPayloadSchema>;
export type PoseClipContinuityEvaluation = z.infer<typeof PoseClipContinuityEvaluationSchema>;
