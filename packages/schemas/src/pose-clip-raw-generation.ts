import {z} from 'zod';
import {
  ContentHashSchema,
  ProducerRefSchema,
} from './common.js';
import {
  PoseFrameArtifactSchema,
  assertPoseClipProductionRequestIntegrity,
  hashPoseFrameArtifactPayload,
  type PoseClipProductionRequest,
} from './pose-clip-production.js';
import {canonicalHash} from './hash.js';

const PoseClipRawFrameGenerationResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  frameJobHash: ContentHashSchema,
  frameIndex: z.number().int().nonnegative(),
  frameSpecHash: ContentHashSchema,
  generationInputHash: ContentHashSchema,
  artifact: PoseFrameArtifactSchema,
} as const;

function refineRawFrameResult(
  result: z.output<z.ZodObject<typeof PoseClipRawFrameGenerationResultPayloadShape>>,
  context: z.RefinementCtx,
): void {
  if (result.artifact.stage !== 'raw') context.addIssue({
    code: 'custom',
    message: 'Raw generation result must contain a raw artifact',
    path: ['artifact', 'stage'],
  });
  if (result.artifact.inputHash !== result.generationInputHash) context.addIssue({
    code: 'custom',
    message: 'Raw artifact must be bound to generationInputHash',
    path: ['artifact', 'inputHash'],
  });
}

export const PoseClipRawFrameGenerationResultPayloadSchema = z.object(
  PoseClipRawFrameGenerationResultPayloadShape,
).strict().superRefine(refineRawFrameResult);

export const PoseClipRawFrameGenerationResultSchema = z.object({
  ...PoseClipRawFrameGenerationResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict().superRefine(refineRawFrameResult);

const PoseClipRawGenerationResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  productionRequestHash: ContentHashSchema,
  frameResults: z.array(PoseClipRawFrameGenerationResultSchema).min(2),
  producer: ProducerRefSchema,
} as const;

export const PoseClipRawGenerationResultPayloadSchema = z.object(
  PoseClipRawGenerationResultPayloadShape,
).strict();

export const PoseClipRawGenerationResultSchema = z.object({
  ...PoseClipRawGenerationResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict();

export class PoseClipRawGenerationIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipRawGenerationIntegrityError';
  }
}

export async function hashPoseClipRawFrameGenerationResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-raw-frame-generation-result-v1',
    PoseClipRawFrameGenerationResultPayloadSchema.parse(input),
  );
}

export async function hashPoseClipRawGenerationResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-raw-generation-result-v1',
    PoseClipRawGenerationResultPayloadSchema.parse(input),
  );
}

export async function createPoseClipRawGenerationResult(input: unknown): Promise<PoseClipRawGenerationResult> {
  const payload = PoseClipRawGenerationResultPayloadSchema.parse(input);
  return assertPoseClipRawGenerationResultIntegrity(undefined, {
    ...payload,
    resultHash: await hashPoseClipRawGenerationResultPayload(payload),
  });
}

export async function assertPoseClipRawGenerationResultIntegrity(
  requestInput: unknown,
  resultInput: unknown,
): Promise<PoseClipRawGenerationResult> {
  const request = requestInput === undefined
    ? undefined
    : await assertPoseClipProductionRequestIntegrity(requestInput);
  const result = PoseClipRawGenerationResultSchema.parse(resultInput);
  if (request !== undefined) {
    if (result.productionRequestHash !== request.requestHash) throw new PoseClipRawGenerationIntegrityError(
      'RAW_GENERATION_REQUEST_BINDING_MISMATCH',
      request.id,
    );
    if (result.frameResults.length !== request.frames.length) throw new PoseClipRawGenerationIntegrityError(
      'RAW_GENERATION_FRAME_COUNT_MISMATCH',
      `Expected ${request.frames.length}, received ${result.frameResults.length}`,
    );
  }
  for (const [index, frameResult] of result.frameResults.entries()) {
    const job = request?.frames[index];
    if (frameResult.frameIndex !== index) throw new PoseClipRawGenerationIntegrityError(
      'RAW_GENERATION_FRAME_ORDER_INVALID',
      `Expected frame ${index}, received ${frameResult.frameIndex}`,
    );
    if (job !== undefined && (
      frameResult.frameJobHash !== job.frameJobHash
      || frameResult.frameSpecHash !== job.spec.frameSpecHash
      || frameResult.generationInputHash !== job.generationRequest.inputHash
      || frameResult.artifact.asset.id !== job.spec.output.assetId
      || frameResult.artifact.asset.kind !== job.spec.output.kind
    )) throw new PoseClipRawGenerationIntegrityError(
      'RAW_GENERATION_FRAME_BINDING_MISMATCH',
      `Frame ${index}`,
    );
    const {outputHash: _outputHash, ...artifactPayload} = frameResult.artifact;
    if (await hashPoseFrameArtifactPayload(artifactPayload) !== frameResult.artifact.outputHash) {
      throw new PoseClipRawGenerationIntegrityError('RAW_GENERATION_ARTIFACT_HASH_MISMATCH', `Frame ${index}`);
    }
    const {resultHash: _resultHash, ...framePayload} = frameResult;
    if (await hashPoseClipRawFrameGenerationResultPayload(framePayload) !== frameResult.resultHash) {
      throw new PoseClipRawGenerationIntegrityError('RAW_GENERATION_FRAME_RESULT_HASH_MISMATCH', `Frame ${index}`);
    }
  }
  const {resultHash: _resultHash, ...payload} = result;
  if (await hashPoseClipRawGenerationResultPayload(payload) !== result.resultHash) {
    throw new PoseClipRawGenerationIntegrityError('RAW_GENERATION_RESULT_HASH_MISMATCH', result.productionRequestHash);
  }
  return result;
}

export type PoseClipRawFrameGenerationResultPayload = z.infer<typeof PoseClipRawFrameGenerationResultPayloadSchema>;
export type PoseClipRawFrameGenerationResult = z.infer<typeof PoseClipRawFrameGenerationResultSchema>;
export type PoseClipRawGenerationResultPayload = z.infer<typeof PoseClipRawGenerationResultPayloadSchema>;
export type PoseClipRawGenerationResult = z.infer<typeof PoseClipRawGenerationResultSchema>;
export type PoseClipRawGenerationRequest = PoseClipProductionRequest;
