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
  assertPoseClipMattingResultIntegrity,
  type PoseClipMattingResult,
} from './pose-clip-matting.js';
import type {
  PoseClipRawGenerationRequest,
  PoseClipRawGenerationResult,
} from './pose-clip-raw-generation.js';

const NORMALIZATION_RESULT_PRODUCER = {name: 'pose-clip-normalization-executor', version: '0.1.0'} as const;

export const PixelBoundsSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const PoseFrameNormalizationTransformSchema = z.object({
  sourceBounds: PixelBoundsSchema,
  destinationBounds: PixelBoundsSchema,
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  scale: z.number().finite().positive(),
}).strict().superRefine((transform, context) => {
  if (
    transform.destinationBounds.width !== Math.max(1, Math.round(transform.sourceBounds.width * transform.scale))
    || transform.destinationBounds.height !== Math.max(1, Math.round(transform.sourceBounds.height * transform.scale))
  ) context.addIssue({
    code: 'custom',
    message: 'Normalization destination bounds must match source bounds and scale',
    path: ['destinationBounds'],
  });
});

export const PoseClipNormalizationInputPayloadSchema = z.object({
  mattedArtifactHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
}).strict();

const PoseClipNormalizedFrameResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  frameJobHash: ContentHashSchema,
  frameIndex: z.number().int().nonnegative(),
  frameSpecHash: ContentHashSchema,
  generationInputHash: ContentHashSchema,
  mattedArtifactHash: ContentHashSchema,
  normalizationInputHash: ContentHashSchema,
  transform: PoseFrameNormalizationTransformSchema,
  artifact: PoseFrameArtifactSchema,
} as const;

function refineNormalizedFrameResult(
  result: z.output<z.ZodObject<typeof PoseClipNormalizedFrameResultPayloadShape>>,
  context: z.RefinementCtx,
): void {
  if (result.artifact.stage !== 'normalized') context.addIssue({
    code: 'custom', message: 'Normalization result must contain a normalized artifact', path: ['artifact', 'stage'],
  });
  if (result.artifact.inputHash !== result.mattedArtifactHash) context.addIssue({
    code: 'custom', message: 'Normalized artifact must be bound to mattedArtifactHash', path: ['artifact', 'inputHash'],
  });
  if (result.artifact.asset.provenance?.inputHash !== result.normalizationInputHash) context.addIssue({
    code: 'custom', message: 'Normalized asset provenance must be bound to normalizationInputHash',
    path: ['artifact', 'asset', 'provenance', 'inputHash'],
  });
  if (
    result.artifact.asset.provenance?.producer.name !== result.artifact.producer.name
    || result.artifact.asset.provenance?.producer.version !== result.artifact.producer.version
  ) context.addIssue({
    code: 'custom', message: 'Normalized artifact producer must match asset provenance producer',
    path: ['artifact', 'producer'],
  });
}

export const PoseClipNormalizedFrameResultPayloadSchema = z.object(
  PoseClipNormalizedFrameResultPayloadShape,
).strict().superRefine(refineNormalizedFrameResult);

export const PoseClipNormalizedFrameResultSchema = z.object({
  ...PoseClipNormalizedFrameResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict().superRefine(refineNormalizedFrameResult);

const PoseClipNormalizationResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  productionRequestHash: ContentHashSchema,
  mattingResultHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
  frameResults: z.array(PoseClipNormalizedFrameResultSchema).length(4),
  producer: ProducerRefSchema,
} as const;

export const PoseClipNormalizationResultPayloadSchema = z.object(
  PoseClipNormalizationResultPayloadShape,
).strict();

export const PoseClipNormalizationResultSchema = z.object({
  ...PoseClipNormalizationResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict();

export class PoseClipNormalizationIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipNormalizationIntegrityError';
  }
}

export function normalizedAssetId(mattedAssetId: string): string {
  return mattedAssetId.endsWith('.matted')
    ? `${mattedAssetId.slice(0, -'.matted'.length)}.normalized`
    : `${mattedAssetId}.normalized`;
}

export async function hashPoseClipNormalizationInput(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-normalization-input-v1',
    PoseClipNormalizationInputPayloadSchema.parse(input),
  );
}

export async function hashPoseClipNormalizedFrameResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-normalized-frame-result-v1',
    PoseClipNormalizedFrameResultPayloadSchema.parse(input),
  );
}

export async function hashPoseClipNormalizationResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-normalization-result-v1',
    PoseClipNormalizationResultPayloadSchema.parse(input),
  );
}

export async function assertPoseClipNormalizationProcessorSpecIntegrity(
  input: unknown,
): Promise<PoseFrameProcessorSpec> {
  const spec = await assertPoseFrameProcessorSpecIntegrity(input);
  if (spec.stage !== 'normalized') throw new PoseClipNormalizationIntegrityError(
    'NORMALIZATION_PROCESSOR_STAGE_INVALID',
    `Expected normalized, received ${spec.stage}`,
  );
  return spec;
}

function assertBoundsInside(
  bounds: z.infer<typeof PixelBoundsSchema>,
  width: number,
  height: number,
  code: string,
  frameIndex: number,
): void {
  if (bounds.x + bounds.width > width || bounds.y + bounds.height > height) {
    throw new PoseClipNormalizationIntegrityError(code, `Frame ${frameIndex}`);
  }
}

export async function assertPoseClipNormalizationResultIntegrity(
  requestInput: PoseClipRawGenerationRequest,
  rawResultInput: PoseClipRawGenerationResult,
  mattingSpecInput: PoseFrameProcessorSpec,
  mattingResultInput: PoseClipMattingResult,
  normalizationSpecInput: unknown,
  resultInput: unknown,
): Promise<PoseClipNormalizationResult> {
  const mattingResult = await assertPoseClipMattingResultIntegrity(
    requestInput, rawResultInput, mattingSpecInput, mattingResultInput,
  );
  const spec = await assertPoseClipNormalizationProcessorSpecIntegrity(normalizationSpecInput);
  const result = PoseClipNormalizationResultSchema.parse(resultInput);
  if (result.productionRequestHash !== mattingResult.productionRequestHash) throw new PoseClipNormalizationIntegrityError(
    'NORMALIZATION_REQUEST_BINDING_MISMATCH', result.productionRequestHash,
  );
  if (result.mattingResultHash !== mattingResult.resultHash) throw new PoseClipNormalizationIntegrityError(
    'NORMALIZATION_MATTING_RESULT_BINDING_MISMATCH', result.mattingResultHash,
  );
  if (result.processorSpecHash !== spec.processorSpecHash) throw new PoseClipNormalizationIntegrityError(
    'NORMALIZATION_PROCESSOR_SPEC_BINDING_MISMATCH', result.processorSpecHash,
  );
  if (
    result.producer.name !== NORMALIZATION_RESULT_PRODUCER.name
    || result.producer.version !== NORMALIZATION_RESULT_PRODUCER.version
  ) throw new PoseClipNormalizationIntegrityError(
    'NORMALIZATION_RESULT_PRODUCER_MISMATCH', `${result.producer.name}@${result.producer.version}`,
  );
  for (const [index, frameResult] of result.frameResults.entries()) {
    const mattedFrame = mattingResult.frameResults[index]!;
    const mattedAsset = mattedFrame.artifact.asset;
    if (
      frameResult.frameIndex !== index
      || frameResult.frameJobHash !== mattedFrame.frameJobHash
      || frameResult.frameSpecHash !== mattedFrame.frameSpecHash
      || frameResult.generationInputHash !== mattedFrame.generationInputHash
      || frameResult.mattedArtifactHash !== mattedFrame.artifact.outputHash
    ) throw new PoseClipNormalizationIntegrityError('NORMALIZATION_FRAME_BINDING_MISMATCH', `Frame ${index}`);
    const expectedInputHash = await hashPoseClipNormalizationInput({
      mattedArtifactHash: mattedFrame.artifact.outputHash,
      processorSpecHash: spec.processorSpecHash,
    });
    if (frameResult.normalizationInputHash !== expectedInputHash) throw new PoseClipNormalizationIntegrityError(
      'NORMALIZATION_INPUT_HASH_MISMATCH', `Frame ${index}`,
    );
    assertBoundsInside(frameResult.transform.sourceBounds, mattedAsset.width, mattedAsset.height,
      'NORMALIZATION_SOURCE_BOUNDS_INVALID', index);
    assertBoundsInside(frameResult.transform.destinationBounds,
      frameResult.transform.canvas.width, frameResult.transform.canvas.height,
      'NORMALIZATION_DESTINATION_BOUNDS_INVALID', index);
    const asset = frameResult.artifact.asset;
    if (
      asset.id !== normalizedAssetId(mattedAsset.id)
      || asset.kind !== mattedAsset.kind
      || asset.source !== 'generated'
      || asset.width !== frameResult.transform.canvas.width
      || asset.height !== frameResult.transform.canvas.height
      || asset.alphaMode !== 'straight'
      || asset.qaStatus !== 'pending'
      || frameResult.artifact.producer.name !== spec.processor.name
      || frameResult.artifact.producer.version !== spec.processor.version
      || asset.provenance?.modelId !== spec.model?.modelId
    ) throw new PoseClipNormalizationIntegrityError('NORMALIZATION_ASSET_BINDING_MISMATCH', `Frame ${index}`);
    const {outputHash: _outputHash, ...artifactPayload} = frameResult.artifact;
    if (await hashPoseFrameArtifactPayload(artifactPayload) !== frameResult.artifact.outputHash) {
      throw new PoseClipNormalizationIntegrityError('NORMALIZATION_ARTIFACT_HASH_MISMATCH', `Frame ${index}`);
    }
    const {resultHash: _frameResultHash, ...framePayload} = frameResult;
    if (await hashPoseClipNormalizedFrameResultPayload(framePayload) !== frameResult.resultHash) {
      throw new PoseClipNormalizationIntegrityError('NORMALIZATION_FRAME_RESULT_HASH_MISMATCH', `Frame ${index}`);
    }
  }
  const {resultHash: _resultHash, ...payload} = result;
  if (await hashPoseClipNormalizationResultPayload(payload) !== result.resultHash) {
    throw new PoseClipNormalizationIntegrityError('NORMALIZATION_RESULT_HASH_MISMATCH', result.productionRequestHash);
  }
  return result;
}

export type PixelBounds = z.infer<typeof PixelBoundsSchema>;
export type PoseFrameNormalizationTransform = z.infer<typeof PoseFrameNormalizationTransformSchema>;
export type PoseClipNormalizedFrameResult = z.infer<typeof PoseClipNormalizedFrameResultSchema>;
export type PoseClipNormalizationResult = z.infer<typeof PoseClipNormalizationResultSchema>;
