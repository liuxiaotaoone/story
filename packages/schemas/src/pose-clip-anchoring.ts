import {z} from 'zod';
import {ContentHashSchema, ProducerRefSchema} from './common.js';
import {canonicalHash} from './hash.js';
import {PoseAnchorsSchema, type PoseAnchors} from './pose-clip.js';
import {
  PoseFrameArtifactSchema,
  hashPoseFrameArtifactPayload,
} from './pose-clip-production.js';
import {
  assertPoseFrameProcessorSpecIntegrity,
  type PoseFrameProcessorSpec,
} from './pose-frame-processing.js';
import {
  assertPoseClipNormalizationResultIntegrity,
  type PoseClipNormalizationResult,
} from './pose-clip-normalization.js';
import type {PoseClipMattingResult} from './pose-clip-matting.js';
import type {
  PoseClipRawGenerationRequest,
  PoseClipRawGenerationResult,
} from './pose-clip-raw-generation.js';

const ANCHORING_RESULT_PRODUCER = {name: 'pose-clip-anchoring-executor', version: '0.1.0'} as const;

export const PoseClipAnchoringInputPayloadSchema = z.object({
  normalizedArtifactHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
}).strict();

const PoseClipAnchoredFrameResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  frameJobHash: ContentHashSchema,
  frameIndex: z.number().int().nonnegative(),
  frameSpecHash: ContentHashSchema,
  generationInputHash: ContentHashSchema,
  normalizedArtifactHash: ContentHashSchema,
  anchorInputHash: ContentHashSchema,
  anchors: PoseAnchorsSchema,
  artifact: PoseFrameArtifactSchema,
} as const;

function refineAnchoredFrameResult(
  result: z.output<z.ZodObject<typeof PoseClipAnchoredFrameResultPayloadShape>>,
  context: z.RefinementCtx,
): void {
  if (result.artifact.stage !== 'anchored') context.addIssue({
    code: 'custom', message: 'Anchoring result must contain an anchored artifact', path: ['artifact', 'stage'],
  });
  if (result.artifact.inputHash !== result.normalizedArtifactHash) context.addIssue({
    code: 'custom', message: 'Anchored artifact must be bound to normalizedArtifactHash',
    path: ['artifact', 'inputHash'],
  });
  if (result.artifact.asset.provenance?.inputHash !== result.anchorInputHash) context.addIssue({
    code: 'custom', message: 'Anchored asset provenance must be bound to anchorInputHash',
    path: ['artifact', 'asset', 'provenance', 'inputHash'],
  });
  if (
    result.artifact.asset.provenance?.producer.name !== result.artifact.producer.name
    || result.artifact.asset.provenance?.producer.version !== result.artifact.producer.version
  ) context.addIssue({
    code: 'custom', message: 'Anchored artifact producer must match asset provenance producer',
    path: ['artifact', 'producer'],
  });
}

export const PoseClipAnchoredFrameResultPayloadSchema = z.object(
  PoseClipAnchoredFrameResultPayloadShape,
).strict().superRefine(refineAnchoredFrameResult);

export const PoseClipAnchoredFrameResultSchema = z.object({
  ...PoseClipAnchoredFrameResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict().superRefine(refineAnchoredFrameResult);

const PoseClipAnchoringResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  productionRequestHash: ContentHashSchema,
  normalizationResultHash: ContentHashSchema,
  processorSpecHash: ContentHashSchema,
  frameResults: z.array(PoseClipAnchoredFrameResultSchema).length(4),
  producer: ProducerRefSchema,
} as const;

export const PoseClipAnchoringResultPayloadSchema = z.object(
  PoseClipAnchoringResultPayloadShape,
).strict();

export const PoseClipAnchoringResultSchema = z.object({
  ...PoseClipAnchoringResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict();

export class PoseClipAnchoringIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipAnchoringIntegrityError';
  }
}

export function anchoredAssetId(normalizedAssetId: string): string {
  if (!normalizedAssetId.endsWith('.normalized')) {
    throw new TypeError('Anchoring input asset must use .normalized identity');
  }
  return normalizedAssetId.slice(0, -'.normalized'.length);
}

export async function hashPoseClipAnchoringInput(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-anchoring-input-v1', PoseClipAnchoringInputPayloadSchema.parse(input));
}

export async function hashPoseClipAnchoredFrameResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-anchored-frame-result-v1',
    PoseClipAnchoredFrameResultPayloadSchema.parse(input),
  );
}

export async function hashPoseClipAnchoringResultPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-anchoring-result-v1', PoseClipAnchoringResultPayloadSchema.parse(input));
}

export async function assertPoseClipAnchoringProcessorSpecIntegrity(
  input: unknown,
): Promise<PoseFrameProcessorSpec> {
  const spec = await assertPoseFrameProcessorSpecIntegrity(input);
  if (spec.stage !== 'anchored') throw new PoseClipAnchoringIntegrityError(
    'ANCHORING_PROCESSOR_STAGE_INVALID',
    `Expected anchored, received ${spec.stage}`,
  );
  return spec;
}

function hasRequiredAnchor(anchors: PoseAnchors, requirement: string): boolean {
  if (requirement.startsWith('auxiliary:')) {
    return anchors.auxiliary?.[requirement.slice('auxiliary:'.length)] !== undefined;
  }
  return anchors[requirement as keyof Omit<PoseAnchors, 'auxiliary'>] !== undefined;
}

export async function assertPoseClipAnchoringResultIntegrity(
  requestInput: PoseClipRawGenerationRequest,
  rawResultInput: PoseClipRawGenerationResult,
  mattingSpecInput: PoseFrameProcessorSpec,
  mattingResultInput: PoseClipMattingResult,
  normalizationSpecInput: PoseFrameProcessorSpec,
  normalizationResultInput: PoseClipNormalizationResult,
  anchoringSpecInput: unknown,
  resultInput: unknown,
): Promise<PoseClipAnchoringResult> {
  const normalizationResult = await assertPoseClipNormalizationResultIntegrity(
    requestInput,
    rawResultInput,
    mattingSpecInput,
    mattingResultInput,
    normalizationSpecInput,
    normalizationResultInput,
  );
  const spec = await assertPoseClipAnchoringProcessorSpecIntegrity(anchoringSpecInput);
  const result = PoseClipAnchoringResultSchema.parse(resultInput);
  if (result.productionRequestHash !== normalizationResult.productionRequestHash) {
    throw new PoseClipAnchoringIntegrityError(
      'ANCHORING_REQUEST_BINDING_MISMATCH', result.productionRequestHash,
    );
  }
  if (result.normalizationResultHash !== normalizationResult.resultHash) {
    throw new PoseClipAnchoringIntegrityError(
      'ANCHORING_NORMALIZATION_RESULT_BINDING_MISMATCH', result.normalizationResultHash,
    );
  }
  if (result.processorSpecHash !== spec.processorSpecHash) throw new PoseClipAnchoringIntegrityError(
    'ANCHORING_PROCESSOR_SPEC_BINDING_MISMATCH', result.processorSpecHash,
  );
  if (
    result.producer.name !== ANCHORING_RESULT_PRODUCER.name
    || result.producer.version !== ANCHORING_RESULT_PRODUCER.version
  ) throw new PoseClipAnchoringIntegrityError(
    'ANCHORING_RESULT_PRODUCER_MISMATCH', `${result.producer.name}@${result.producer.version}`,
  );
  for (const [index, frameResult] of result.frameResults.entries()) {
    const normalizedFrame = normalizationResult.frameResults[index]!;
    const normalizedAsset = normalizedFrame.artifact.asset;
    if (
      frameResult.frameIndex !== index
      || frameResult.frameJobHash !== normalizedFrame.frameJobHash
      || frameResult.frameSpecHash !== normalizedFrame.frameSpecHash
      || frameResult.generationInputHash !== normalizedFrame.generationInputHash
      || frameResult.normalizedArtifactHash !== normalizedFrame.artifact.outputHash
    ) throw new PoseClipAnchoringIntegrityError('ANCHORING_FRAME_BINDING_MISMATCH', `Frame ${index}`);
    const expectedInputHash = await hashPoseClipAnchoringInput({
      normalizedArtifactHash: normalizedFrame.artifact.outputHash,
      processorSpecHash: spec.processorSpecHash,
    });
    if (frameResult.anchorInputHash !== expectedInputHash) throw new PoseClipAnchoringIntegrityError(
      'ANCHORING_INPUT_HASH_MISMATCH', `Frame ${index}`,
    );
    const requiredAnchors = requestInput.frames[index]!.spec.requiredAnchors;
    if (requiredAnchors.some((requirement) => !hasRequiredAnchor(frameResult.anchors, requirement))) {
      throw new PoseClipAnchoringIntegrityError('ANCHORING_REQUIRED_ANCHOR_MISSING', `Frame ${index}`);
    }
    const asset = frameResult.artifact.asset;
    if (
      asset.id !== anchoredAssetId(normalizedAsset.id)
      || asset.kind !== normalizedAsset.kind
      || asset.source !== 'generated'
      || asset.contentHash !== normalizedAsset.contentHash
      || asset.width !== normalizedAsset.width
      || asset.height !== normalizedAsset.height
      || asset.alphaMode !== 'straight'
      || asset.qaStatus !== 'pending'
      || frameResult.artifact.producer.name !== spec.processor.name
      || frameResult.artifact.producer.version !== spec.processor.version
      || asset.provenance?.modelId !== spec.model?.modelId
    ) throw new PoseClipAnchoringIntegrityError('ANCHORING_ASSET_BINDING_MISMATCH', `Frame ${index}`);
    const {outputHash: _outputHash, ...artifactPayload} = frameResult.artifact;
    if (await hashPoseFrameArtifactPayload(artifactPayload) !== frameResult.artifact.outputHash) {
      throw new PoseClipAnchoringIntegrityError('ANCHORING_ARTIFACT_HASH_MISMATCH', `Frame ${index}`);
    }
    const {resultHash: _frameResultHash, ...framePayload} = frameResult;
    if (await hashPoseClipAnchoredFrameResultPayload(framePayload) !== frameResult.resultHash) {
      throw new PoseClipAnchoringIntegrityError('ANCHORING_FRAME_RESULT_HASH_MISMATCH', `Frame ${index}`);
    }
  }
  const {resultHash: _resultHash, ...payload} = result;
  if (await hashPoseClipAnchoringResultPayload(payload) !== result.resultHash) {
    throw new PoseClipAnchoringIntegrityError('ANCHORING_RESULT_HASH_MISMATCH', result.productionRequestHash);
  }
  return result;
}

export type PoseClipAnchoredFrameResult = z.infer<typeof PoseClipAnchoredFrameResultSchema>;
export type PoseClipAnchoringResultPayload = z.infer<typeof PoseClipAnchoringResultPayloadSchema>;
export type PoseClipAnchoringResult = z.infer<typeof PoseClipAnchoringResultSchema>;
