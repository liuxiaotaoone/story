import {z} from 'zod';
import {
  ContentHashSchema,
  IdSchema,
  JsonValueSchema,
  ProducerRefSchema,
} from './common.js';
import {canonicalHash} from './hash.js';

export const PoseFrameProcessStageSchema = z.enum(['matted', 'normalized', 'anchored']);

export const PoseFrameProcessorModelSchema = z.object({
  modelId: IdSchema,
  contentHash: ContentHashSchema,
}).strict();

const PoseFrameProcessorSpecPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  stage: PoseFrameProcessStageSchema,
  processor: ProducerRefSchema,
  model: PoseFrameProcessorModelSchema.optional(),
  config: JsonValueSchema,
} as const;

export const PoseFrameProcessorSpecPayloadSchema = z.object(
  PoseFrameProcessorSpecPayloadShape,
).strict();

export const PoseFrameProcessorSpecSchema = z.object({
  ...PoseFrameProcessorSpecPayloadShape,
  processorSpecHash: ContentHashSchema,
}).strict();

export const PoseFrameStageCacheKeyPayloadSchema = z.object({
  stage: PoseFrameProcessStageSchema,
  inputContentHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
}).strict();

export const PoseFrameExecutionKeyPayloadSchema = z.object({
  frameJobHash: ContentHashSchema,
  processorSpecHashes: z.object({
    matted: ContentHashSchema,
    normalized: ContentHashSchema,
    anchored: ContentHashSchema,
  }).strict(),
  qaEvaluator: ProducerRefSchema,
  executor: ProducerRefSchema,
}).strict();

export class PoseFrameProcessorSpecIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseFrameProcessorSpecIntegrityError';
  }
}

export async function hashPoseFrameProcessorSpecPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-frame-processor-spec-v1', PoseFrameProcessorSpecPayloadSchema.parse(input));
}

export async function createPoseFrameProcessorSpec(input: unknown): Promise<PoseFrameProcessorSpec> {
  const payload = PoseFrameProcessorSpecPayloadSchema.parse(input);
  return PoseFrameProcessorSpecSchema.parse({
    ...payload,
    processorSpecHash: await hashPoseFrameProcessorSpecPayload(payload),
  });
}

export async function assertPoseFrameProcessorSpecIntegrity(input: unknown): Promise<PoseFrameProcessorSpec> {
  const spec = PoseFrameProcessorSpecSchema.parse(input);
  const {processorSpecHash: _processorSpecHash, ...payload} = spec;
  if (await hashPoseFrameProcessorSpecPayload(payload) !== spec.processorSpecHash) {
    throw new PoseFrameProcessorSpecIntegrityError(
      'POSE_FRAME_PROCESSOR_SPEC_HASH_MISMATCH',
      spec.stage,
    );
  }
  return spec;
}

export async function poseFrameStageCacheKey(input: unknown): Promise<string> {
  return canonicalHash('pose-frame-stage-cache-v1', PoseFrameStageCacheKeyPayloadSchema.parse(input));
}

export async function poseFrameExecutionKey(input: unknown): Promise<string> {
  return canonicalHash('pose-frame-execution-v1', PoseFrameExecutionKeyPayloadSchema.parse(input));
}

export type PoseFrameProcessStage = z.infer<typeof PoseFrameProcessStageSchema>;
export type PoseFrameProcessorModel = z.infer<typeof PoseFrameProcessorModelSchema>;
export type PoseFrameProcessorSpecPayload = z.infer<typeof PoseFrameProcessorSpecPayloadSchema>;
export type PoseFrameProcessorSpec = z.infer<typeof PoseFrameProcessorSpecSchema>;
export type PoseFrameStageCacheKeyPayload = z.infer<typeof PoseFrameStageCacheKeyPayloadSchema>;
export type PoseFrameExecutionKeyPayload = z.infer<typeof PoseFrameExecutionKeyPayloadSchema>;
