import {z} from 'zod';
import {ContentHashSchema, ProducerRefSchema} from './common.js';
import {canonicalHash} from './hash.js';
import {
  PoseFrameArtifactSchema,
  hashPoseFrameArtifactPayload,
} from './pose-clip-production.js';
import {
  assertPoseFrameProcessorSpecIntegrity,
  type PoseFrameProcessorSpec,
} from './pose-frame-processing.js';
import {
  assertPoseClipRawGenerationResultIntegrity,
  type PoseClipRawGenerationRequest,
} from './pose-clip-raw-generation.js';

const MATTING_RESULT_PRODUCER = {name: 'pose-clip-matting-executor', version: '0.1.0'} as const;

export const PoseClipMattingInputPayloadSchema = z.object({
  rawArtifactHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
}).strict();

const PoseClipMattedFrameResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  frameJobHash: ContentHashSchema,
  frameIndex: z.number().int().nonnegative(),
  frameSpecHash: ContentHashSchema,
  generationInputHash: ContentHashSchema,
  rawArtifactHash: ContentHashSchema,
  mattingInputHash: ContentHashSchema,
  artifact: PoseFrameArtifactSchema,
} as const;

function refineMattedFrameResult(
  result: z.output<z.ZodObject<typeof PoseClipMattedFrameResultPayloadShape>>,
  context: z.RefinementCtx,
): void {
  if (result.artifact.stage !== 'matted') context.addIssue({
    code: 'custom',
    message: 'Matting result must contain a matted artifact',
    path: ['artifact', 'stage'],
  });
  if (result.artifact.inputHash !== result.rawArtifactHash) context.addIssue({
    code: 'custom',
    message: 'Matted artifact must be bound to rawArtifactHash',
    path: ['artifact', 'inputHash'],
  });
  if (result.artifact.asset.provenance?.inputHash !== result.mattingInputHash) context.addIssue({
    code: 'custom',
    message: 'Matted asset provenance must be bound to mattingInputHash',
    path: ['artifact', 'asset', 'provenance', 'inputHash'],
  });
  if (
    result.artifact.asset.provenance?.producer.name !== result.artifact.producer.name
    || result.artifact.asset.provenance?.producer.version !== result.artifact.producer.version
  ) context.addIssue({
    code: 'custom',
    message: 'Matted artifact producer must match asset provenance producer',
    path: ['artifact', 'producer'],
  });
}

export const PoseClipMattedFrameResultPayloadSchema = z.object(
  PoseClipMattedFrameResultPayloadShape,
).strict().superRefine(refineMattedFrameResult);

export const PoseClipMattedFrameResultSchema = z.object({
  ...PoseClipMattedFrameResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict().superRefine(refineMattedFrameResult);

const PoseClipMattingResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  productionRequestHash: ContentHashSchema,
  rawGenerationResultHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
  frameResults: z.array(PoseClipMattedFrameResultSchema).length(4),
  producer: ProducerRefSchema,
} as const;

export const PoseClipMattingResultPayloadSchema = z.object(
  PoseClipMattingResultPayloadShape,
).strict();

export const PoseClipMattingResultSchema = z.object({
  ...PoseClipMattingResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict();

export class PoseClipMattingIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipMattingIntegrityError';
  }
}

export async function hashPoseClipMattingInput(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-matting-input-v1', PoseClipMattingInputPayloadSchema.parse(input));
}

export async function hashPoseClipMattedFrameResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-matted-frame-result-v1',
    PoseClipMattedFrameResultPayloadSchema.parse(input),
  );
}

export async function hashPoseClipMattingResultPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-matting-result-v1', PoseClipMattingResultPayloadSchema.parse(input));
}

export async function assertPoseClipMattingProcessorSpecIntegrity(
  input: unknown,
): Promise<PoseFrameProcessorSpec> {
  const spec = await assertPoseFrameProcessorSpecIntegrity(input);
  if (spec.stage !== 'matted') throw new PoseClipMattingIntegrityError(
    'MATTING_PROCESSOR_STAGE_INVALID',
    `Expected matted, received ${spec.stage}`,
  );
  if (spec.model === undefined) throw new PoseClipMattingIntegrityError(
    'MATTING_PROCESSOR_MODEL_MISSING',
    'Real Matting requires a content-addressed model identity',
  );
  return spec;
}

export async function assertPoseClipMattingResultIntegrity(
  requestInput: unknown,
  rawResultInput: unknown,
  processorSpecInput: unknown,
  resultInput: unknown,
): Promise<PoseClipMattingResult> {
  const request = requestInput as PoseClipRawGenerationRequest;
  const rawResult = await assertPoseClipRawGenerationResultIntegrity(request, rawResultInput);
  const processorSpec = await assertPoseClipMattingProcessorSpecIntegrity(processorSpecInput);
  const result = PoseClipMattingResultSchema.parse(resultInput);
  if (result.productionRequestHash !== rawResult.productionRequestHash) throw new PoseClipMattingIntegrityError(
    'MATTING_REQUEST_BINDING_MISMATCH',
    rawResult.productionRequestHash,
  );
  if (result.rawGenerationResultHash !== rawResult.resultHash) throw new PoseClipMattingIntegrityError(
    'MATTING_RAW_RESULT_BINDING_MISMATCH',
    rawResult.resultHash,
  );
  if (result.processorSpecHash !== processorSpec.processorSpecHash) throw new PoseClipMattingIntegrityError(
    'MATTING_PROCESSOR_SPEC_BINDING_MISMATCH',
    processorSpec.processorSpecHash,
  );
  if (
    result.producer.name !== MATTING_RESULT_PRODUCER.name
    || result.producer.version !== MATTING_RESULT_PRODUCER.version
  ) throw new PoseClipMattingIntegrityError(
    'MATTING_RESULT_PRODUCER_MISMATCH',
    `${result.producer.name}@${result.producer.version}`,
  );
  for (const [index, frameResult] of result.frameResults.entries()) {
    const rawFrame = rawResult.frameResults[index]!;
    const rawAsset = rawFrame.artifact.asset;
    if (
      frameResult.frameIndex !== index
      || frameResult.frameJobHash !== rawFrame.frameJobHash
      || frameResult.frameSpecHash !== rawFrame.frameSpecHash
      || frameResult.generationInputHash !== rawFrame.generationInputHash
      || frameResult.rawArtifactHash !== rawFrame.artifact.outputHash
    ) throw new PoseClipMattingIntegrityError('MATTING_FRAME_BINDING_MISMATCH', `Frame ${index}`);
    const expectedInputHash = await hashPoseClipMattingInput({
      rawArtifactHash: rawFrame.artifact.outputHash,
      processorSpecHash: processorSpec.processorSpecHash,
    });
    if (frameResult.mattingInputHash !== expectedInputHash) throw new PoseClipMattingIntegrityError(
      'MATTING_INPUT_HASH_MISMATCH',
      `Frame ${index}`,
    );
    const asset = frameResult.artifact.asset;
    if (
      asset.id !== `${rawAsset.id}.matted`
      || asset.kind !== rawAsset.kind
      || asset.source !== 'generated'
      || asset.width !== rawAsset.width
      || asset.height !== rawAsset.height
      || asset.alphaMode !== 'straight'
      || asset.qaStatus !== 'pending'
      || frameResult.artifact.producer.name !== processorSpec.processor.name
      || frameResult.artifact.producer.version !== processorSpec.processor.version
      || asset.provenance?.modelId !== processorSpec.model!.modelId
    ) throw new PoseClipMattingIntegrityError('MATTING_ASSET_BINDING_MISMATCH', `Frame ${index}`);
    const {outputHash: _outputHash, ...artifactPayload} = frameResult.artifact;
    if (await hashPoseFrameArtifactPayload(artifactPayload) !== frameResult.artifact.outputHash) {
      throw new PoseClipMattingIntegrityError('MATTING_ARTIFACT_HASH_MISMATCH', `Frame ${index}`);
    }
    const {resultHash: _resultHash, ...framePayload} = frameResult;
    if (await hashPoseClipMattedFrameResultPayload(framePayload) !== frameResult.resultHash) {
      throw new PoseClipMattingIntegrityError('MATTING_FRAME_RESULT_HASH_MISMATCH', `Frame ${index}`);
    }
  }
  const {resultHash: _resultHash, ...payload} = result;
  if (await hashPoseClipMattingResultPayload(payload) !== result.resultHash) throw new PoseClipMattingIntegrityError(
    'MATTING_RESULT_HASH_MISMATCH',
    result.productionRequestHash,
  );
  return result;
}

export type PoseClipMattingInputPayload = z.infer<typeof PoseClipMattingInputPayloadSchema>;
export type PoseClipMattedFrameResultPayload = z.infer<typeof PoseClipMattedFrameResultPayloadSchema>;
export type PoseClipMattedFrameResult = z.infer<typeof PoseClipMattedFrameResultSchema>;
export type PoseClipMattingResultPayload = z.infer<typeof PoseClipMattingResultPayloadSchema>;
export type PoseClipMattingResult = z.infer<typeof PoseClipMattingResultSchema>;
