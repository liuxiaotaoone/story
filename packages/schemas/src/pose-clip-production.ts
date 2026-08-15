import {z} from 'zod';
import {
  VisualAssetRecordSchema,
  contentAddressedAssetUri,
} from './asset.js';
import {
  ContentHashSchema,
  IdSchema,
  ProducerRefSchema,
} from './common.js';
import {
  ActionGenerationRequestSchema,
  GenerationReferenceAssetSchema,
  actionGenerationRequestPayload,
  hashActionGenerationRequestPayload,
} from './generation.js';
import {canonicalHash, canonicalizeJson} from './hash.js';
import {
  CompositeSlotSchema,
  DirectionSchema,
  FootContactSchema,
  GroundLockSchema,
  PoseClipFrameSchema,
  PoseClipSchema,
  ReferenceFootSchema,
} from './pose-clip.js';
import type {PoseClipFrame} from './pose-clip.js';

export const PoseFramePhaseSchema = IdSchema;
export const PoseAnchorRequirementSchema = z.union([
  z.enum(['foot', 'leftFoot', 'rightFoot', 'center', 'leftHand', 'rightHand', 'head']),
  z.string().regex(/^auxiliary:[A-Za-z0-9._-]+$/u, 'Expected auxiliary:<anchor-id>'),
]);

const PoseClipFrameSpecPayloadShape = {
  frameIndex: z.number().int().nonnegative(),
  phase: PoseFramePhaseSchema,
  poseIntent: z.string().trim().min(1),
  durationFrames: z.number().int().positive(),
  contact: FootContactSchema,
  referenceFoot: ReferenceFootSchema,
  requiredAnchors: z.array(PoseAnchorRequirementSchema).min(2),
  seed: z.number().int().nonnegative().safe(),
  referenceAssets: z.array(GenerationReferenceAssetSchema),
  output: z.object({
    assetId: IdSchema,
    kind: z.enum(['character-frame', 'animal-frame']),
  }).strict(),
} as const;

function refineFrameSpec(
  spec: z.output<z.ZodObject<typeof PoseClipFrameSpecPayloadShape>>,
  context: z.RefinementCtx,
): void {
  const anchors = new Set<string>();
  for (const [index, anchor] of spec.requiredAnchors.entries()) {
    if (anchors.has(anchor)) context.addIssue({
      code: 'custom', message: `Duplicate required anchor: ${anchor}`,
      path: ['requiredAnchors', index],
    });
    anchors.add(anchor);
  }
  for (const required of ['foot', 'center']) {
    if (!anchors.has(required)) context.addIssue({
      code: 'custom', message: `Pose frame requires ${required} anchor`, path: ['requiredAnchors'],
    });
  }
  if ((spec.contact === 'left-foot' || spec.contact === 'both') && !anchors.has('leftFoot')) context.addIssue({
    code: 'custom', message: `${spec.contact} contact requires leftFoot anchor`, path: ['requiredAnchors'],
  });
  if ((spec.contact === 'right-foot' || spec.contact === 'both') && !anchors.has('rightFoot')) context.addIssue({
    code: 'custom', message: `${spec.contact} contact requires rightFoot anchor`, path: ['requiredAnchors'],
  });
  if (spec.referenceFoot === 'left-foot' && !anchors.has('leftFoot')) context.addIssue({
    code: 'custom', message: 'left-foot reference requires leftFoot anchor', path: ['requiredAnchors'],
  });
  if (spec.referenceFoot === 'right-foot' && !anchors.has('rightFoot')) context.addIssue({
    code: 'custom', message: 'right-foot reference requires rightFoot anchor', path: ['requiredAnchors'],
  });
  if (spec.referenceFoot === 'midpoint' && (!anchors.has('leftFoot') || !anchors.has('rightFoot'))) context.addIssue({
    code: 'custom', message: 'midpoint reference requires leftFoot and rightFoot anchors', path: ['requiredAnchors'],
  });
  const referenceIds = new Set<string>();
  for (const [index, reference] of spec.referenceAssets.entries()) {
    if (referenceIds.has(reference.assetId)) context.addIssue({
      code: 'custom', message: `Duplicate frame reference asset: ${reference.assetId}`,
      path: ['referenceAssets', index, 'assetId'],
    });
    referenceIds.add(reference.assetId);
  }
}

export const PoseClipFrameSpecPayloadSchema = z.object(
  PoseClipFrameSpecPayloadShape,
).strict().superRefine(refineFrameSpec);

export const PoseClipFrameSpecSchema = z.object({
  ...PoseClipFrameSpecPayloadShape,
  frameSpecHash: ContentHashSchema,
}).strict().superRefine(refineFrameSpec);

const PoseClipFrameJobPayloadShape = {
  spec: PoseClipFrameSpecSchema,
  generationRequest: ActionGenerationRequestSchema,
} as const;

function refineFrameJob(
  job: z.output<z.ZodObject<typeof PoseClipFrameJobPayloadShape>>,
  context: z.RefinementCtx,
): void {
  const request = job.generationRequest;
  const spec = job.spec;
  if (request.frameSpecHash !== spec.frameSpecHash) context.addIssue({
    code: 'custom', message: 'Generation request frameSpecHash must match FrameSpec',
    path: ['generationRequest', 'frameSpecHash'],
  });
  if (request.seed !== spec.seed) context.addIssue({
    code: 'custom', message: 'Generation request seed must match FrameSpec', path: ['generationRequest', 'seed'],
  });
  if (request.output.assetId !== spec.output.assetId || request.output.kind !== spec.output.kind) context.addIssue({
    code: 'custom', message: 'Generation output must match FrameSpec output', path: ['generationRequest', 'output'],
  });
  if (canonicalizeJson(request.referenceAssets) !== canonicalizeJson(spec.referenceAssets)) context.addIssue({
    code: 'custom', message: 'Generation references must match FrameSpec references',
    path: ['generationRequest', 'referenceAssets'],
  });
}

export const PoseClipFrameJobPayloadSchema = z.object(
  PoseClipFrameJobPayloadShape,
).strict().superRefine(refineFrameJob);

export const PoseClipFrameJobSchema = z.object({
  ...PoseClipFrameJobPayloadShape,
  frameJobHash: ContentHashSchema,
}).strict().superRefine(refineFrameJob);

const PoseClipProductionRequestPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  id: IdSchema,
  actionPackageId: IdSchema,
  poseClipId: IdSchema,
  entityType: IdSchema,
  action: IdSchema,
  direction: DirectionSchema,
  loop: z.boolean(),
  rootMotion: z.object({mode: z.literal('timeline')}).strict(),
  groundLock: GroundLockSchema,
  tags: z.array(IdSchema).optional(),
  compositeSlots: z.array(CompositeSlotSchema).optional(),
  frames: z.array(PoseClipFrameJobSchema).min(2),
} as const;

function refineProductionRequest(
  request: z.output<z.ZodObject<typeof PoseClipProductionRequestPayloadShape>>,
  context: z.RefinementCtx,
): void {
  const assetIds = new Set<string>();
  for (const [index, frame] of request.frames.entries()) {
    if (frame.spec.frameIndex !== index) context.addIssue({
      code: 'custom', message: `Frame indices must be contiguous from zero; expected ${index}`,
      path: ['frames', index, 'spec', 'frameIndex'],
    });
    if (assetIds.has(frame.spec.output.assetId)) context.addIssue({
      code: 'custom', message: `Duplicate frame output asset: ${frame.spec.output.assetId}`,
      path: ['frames', index, 'spec', 'output', 'assetId'],
    });
    assetIds.add(frame.spec.output.assetId);
    const generation = frame.generationRequest;
    for (const [field, expected] of [
      ['actionPackageId', request.actionPackageId],
      ['entityType', request.entityType],
      ['action', request.action],
      ['direction', request.direction],
    ] as const) {
      if (generation[field] !== expected) context.addIssue({
        code: 'custom', message: `Generation request ${field} must match PoseClip production request`,
        path: ['frames', index, 'generationRequest', field],
      });
    }
  }
  const slotIds = new Set<string>();
  for (const [index, slot] of (request.compositeSlots ?? []).entries()) {
    if (slotIds.has(slot.id)) context.addIssue({
      code: 'custom', message: `Duplicate production composite slot: ${slot.id}`,
      path: ['compositeSlots', index, 'id'],
    });
    slotIds.add(slot.id);
  }
}

export const PoseClipProductionRequestPayloadSchema = z.object(
  PoseClipProductionRequestPayloadShape,
).strict().superRefine(refineProductionRequest);

export const PoseClipProductionRequestSchema = z.object({
  ...PoseClipProductionRequestPayloadShape,
  requestHash: ContentHashSchema,
}).strict().superRefine(refineProductionRequest);

export const ProductionQaStatusSchema = z.enum(['pending', 'passed', 'warning', 'failed', 'not-applicable']);
export const PoseProductionDiagnosticSchema = z.object({
  code: IdSchema,
  severity: z.enum(['warning', 'error']),
  message: z.string().trim().min(1),
  frameIndex: z.number().int().nonnegative().optional(),
  comparedFrameIndex: z.number().int().nonnegative().optional(),
  stage: IdSchema.optional(),
}).strict();

export const PoseFrameProductionQaSchema = z.object({
  structural: ProductionQaStatusSchema,
  matting: ProductionQaStatusSchema,
  normalization: ProductionQaStatusSchema,
  anchors: ProductionQaStatusSchema,
  productionReady: z.boolean(),
  diagnostics: z.array(PoseProductionDiagnosticSchema),
}).strict().superRefine((qa, context) => {
  if (qa.productionReady && (
    qa.structural !== 'passed'
    || qa.matting !== 'passed'
    || qa.normalization !== 'passed'
    || qa.anchors !== 'passed'
    || qa.diagnostics.some(({severity}) => severity === 'error')
  )) context.addIssue({
    code: 'custom', message: 'Frame productionReady requires every QA stage passed and no errors',
    path: ['productionReady'],
  });
});

export const PoseFrameArtifactStageSchema = z.enum(['raw', 'matted', 'normalized', 'anchored']);
export const ProductionVisualAssetSchema = VisualAssetRecordSchema.superRefine((asset, context) => {
  if (asset.uri !== contentAddressedAssetUri(asset.contentHash)) context.addIssue({
    code: 'custom',
    message: 'Production artifacts require asset://sha256/<contentHash> identity',
    path: ['uri'],
  });
});
const PoseFrameArtifactPayloadShape = {
  stage: PoseFrameArtifactStageSchema,
  inputHash: ContentHashSchema,
  producer: ProducerRefSchema,
  asset: ProductionVisualAssetSchema,
} as const;
export const PoseFrameArtifactPayloadSchema = z.object(PoseFrameArtifactPayloadShape).strict();
export const PoseFrameArtifactSchema = z.object({
  ...PoseFrameArtifactPayloadShape,
  outputHash: ContentHashSchema,
}).strict();

const PoseClipFrameProductionResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  frameJobHash: ContentHashSchema,
  frameIndex: z.number().int().nonnegative(),
  frameSpecHash: ContentHashSchema,
  generationInputHash: ContentHashSchema,
  artifacts: z.array(PoseFrameArtifactSchema).length(4),
  poseFrame: PoseClipFrameSchema,
  qa: PoseFrameProductionQaSchema,
} as const;

function refineFrameResult(
  result: z.output<z.ZodObject<typeof PoseClipFrameProductionResultPayloadShape>>,
  context: z.RefinementCtx,
): void {
  const stages = PoseFrameArtifactStageSchema.options;
  for (const [index, stage] of stages.entries()) {
    const artifact = result.artifacts[index];
    if (artifact?.stage !== stage) context.addIssue({
      code: 'custom', message: `Artifact ${index} must be stage ${stage}`,
      path: ['artifacts', index, 'stage'],
    });
    if (index === 0 && artifact?.inputHash !== result.generationInputHash) context.addIssue({
      code: 'custom', message: 'Raw artifact inputHash must equal generationInputHash',
      path: ['artifacts', index, 'inputHash'],
    });
    if (index > 0 && artifact?.inputHash !== result.artifacts[index - 1]?.outputHash) context.addIssue({
      code: 'custom', message: `${stage} artifact must depend on the previous artifact outputHash`,
      path: ['artifacts', index, 'inputHash'],
    });
  }
  const finalAsset = result.artifacts[3]?.asset;
  if (finalAsset !== undefined && result.poseFrame.assetId !== finalAsset.id) context.addIssue({
    code: 'custom', message: 'Pose frame must reference the anchored artifact asset', path: ['poseFrame', 'assetId'],
  });
}

export const PoseClipFrameProductionResultPayloadSchema = z.object(
  PoseClipFrameProductionResultPayloadShape,
).strict().superRefine(refineFrameResult);
export const PoseClipFrameProductionResultSchema = z.object({
  ...PoseClipFrameProductionResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict().superRefine(refineFrameResult);

export const PoseClipProductionQaSchema = z.object({
  structural: ProductionQaStatusSchema,
  continuity: ProductionQaStatusSchema,
  anchors: ProductionQaStatusSchema,
  identityConsistency: ProductionQaStatusSchema,
  scaleConsistency: ProductionQaStatusSchema,
  canvasConsistency: ProductionQaStatusSchema,
  bodyProportion: ProductionQaStatusSchema,
  footContact: ProductionQaStatusSchema,
  anchorMovement: ProductionQaStatusSchema,
  silhouetteContinuity: ProductionQaStatusSchema,
  loopClosure: ProductionQaStatusSchema,
  humanReview: z.enum(['pending', 'approved', 'rejected']),
  productionReady: z.boolean(),
  diagnostics: z.array(PoseProductionDiagnosticSchema),
}).strict().superRefine((qa, context) => {
  const automated = [
    qa.structural, qa.continuity, qa.anchors, qa.identityConsistency,
    qa.scaleConsistency, qa.canvasConsistency, qa.bodyProportion,
    qa.footContact, qa.anchorMovement, qa.silhouetteContinuity,
  ];
  if (qa.productionReady && (
    automated.some(status => status !== 'passed')
    || !['passed', 'not-applicable'].includes(qa.loopClosure)
    || qa.humanReview !== 'approved'
    || qa.diagnostics.some(({severity}) => severity === 'error')
  )) context.addIssue({
    code: 'custom', message: 'Clip productionReady requires passed QA, approved review and no errors',
    path: ['productionReady'],
  });
});

const PoseClipProductionResultPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  productionRequestHash: ContentHashSchema,
  frameResults: z.array(PoseClipFrameProductionResultSchema).min(2),
  poseClip: PoseClipSchema,
  poseClipHash: ContentHashSchema,
  producer: ProducerRefSchema,
  qa: PoseClipProductionQaSchema,
} as const;

export const PoseClipProductionResultPayloadSchema = z.object(
  PoseClipProductionResultPayloadShape,
).strict();
export const PoseClipProductionResultSchema = z.object({
  ...PoseClipProductionResultPayloadShape,
  resultHash: ContentHashSchema,
}).strict();

export class PoseClipProductionIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipProductionIntegrityError';
  }
}

export async function hashPoseClipFrameSpecPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-frame-spec-v1', PoseClipFrameSpecPayloadSchema.parse(input));
}

export async function createPoseClipFrameSpec(input: unknown): Promise<PoseClipFrameSpec> {
  const payload = PoseClipFrameSpecPayloadSchema.parse(input);
  return PoseClipFrameSpecSchema.parse({...payload, frameSpecHash: await hashPoseClipFrameSpecPayload(payload)});
}

export async function hashPoseClipFrameJobPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-frame-job-v1', PoseClipFrameJobPayloadSchema.parse(input));
}

export async function assertPoseClipFrameJobIntegrity(input: unknown): Promise<PoseClipFrameJob> {
  const job = PoseClipFrameJobSchema.parse(input);
  const {frameSpecHash: _frameSpecHash, ...specPayload} = job.spec;
  if (await hashPoseClipFrameSpecPayload(specPayload) !== job.spec.frameSpecHash) {
    throw new PoseClipProductionIntegrityError('FRAME_SPEC_HASH_MISMATCH', `Frame ${job.spec.frameIndex}`);
  }
  const generationHash = await hashActionGenerationRequestPayload(actionGenerationRequestPayload(job.generationRequest));
  if (generationHash !== job.generationRequest.inputHash) {
    throw new PoseClipProductionIntegrityError('GENERATION_INPUT_HASH_MISMATCH', `Frame ${job.spec.frameIndex}`);
  }
  const {frameJobHash: _frameJobHash, ...payload} = job;
  if (await hashPoseClipFrameJobPayload(payload) !== job.frameJobHash) {
    throw new PoseClipProductionIntegrityError('FRAME_JOB_HASH_MISMATCH', `Frame ${job.spec.frameIndex}`);
  }
  return job;
}

export async function createPoseClipFrameJob(input: unknown): Promise<PoseClipFrameJob> {
  const payload = PoseClipFrameJobPayloadSchema.parse(input);
  return assertPoseClipFrameJobIntegrity({
    ...payload,
    frameJobHash: await hashPoseClipFrameJobPayload(payload),
  });
}

export async function hashPoseClipProductionRequestPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-production-request-v1', PoseClipProductionRequestPayloadSchema.parse(input));
}

export async function assertPoseClipProductionRequestIntegrity(input: unknown): Promise<PoseClipProductionRequest> {
  const request = PoseClipProductionRequestSchema.parse(input);
  for (const frame of request.frames) {
    await assertPoseClipFrameJobIntegrity(frame);
  }
  const {requestHash: _requestHash, ...payload} = request;
  if (await hashPoseClipProductionRequestPayload(payload) !== request.requestHash) {
    throw new PoseClipProductionIntegrityError('PRODUCTION_REQUEST_HASH_MISMATCH', request.id);
  }
  return request;
}

export async function createPoseClipProductionRequest(input: unknown): Promise<PoseClipProductionRequest> {
  const payload = PoseClipProductionRequestPayloadSchema.parse(input);
  return assertPoseClipProductionRequestIntegrity({
    ...payload,
    requestHash: await hashPoseClipProductionRequestPayload(payload),
  });
}

export function poseClipProductionRequestPayload(request: PoseClipProductionRequest): PoseClipProductionRequestPayload {
  const {requestHash: _requestHash, ...payload} = PoseClipProductionRequestSchema.parse(request);
  return PoseClipProductionRequestPayloadSchema.parse(payload);
}

export async function hashPoseFrameArtifactPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-frame-artifact-v1', PoseFrameArtifactPayloadSchema.parse(input));
}

export async function hashPoseClipFrameProductionResultPayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-frame-production-result-v1',
    PoseClipFrameProductionResultPayloadSchema.parse(input),
  );
}

export async function hashPoseClipContent(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-v1', PoseClipSchema.parse(input));
}

export async function hashPoseClipProductionResultPayload(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-production-result-v1', PoseClipProductionResultPayloadSchema.parse(input));
}

function hasRequiredAnchor(
  anchors: PoseClipFrame['anchors'],
  requirement: PoseAnchorRequirement,
): boolean {
  if (requirement.startsWith('auxiliary:')) {
    const anchorId = requirement.slice('auxiliary:'.length);
    return anchors.auxiliary?.[anchorId] !== undefined;
  }

  const directAnchor = requirement as Exclude<keyof PoseClipFrame['anchors'], 'auxiliary'>;
  return anchors[directAnchor] !== undefined;
}

export async function assertPoseClipProductionResultIntegrity(
  requestInput: unknown,
  resultInput: unknown,
): Promise<PoseClipProductionResult> {
  const request = await assertPoseClipProductionRequestIntegrity(requestInput);
  const result = PoseClipProductionResultSchema.parse(resultInput);
  if (result.productionRequestHash !== request.requestHash) throw new PoseClipProductionIntegrityError(
    'PRODUCTION_REQUEST_BINDING_MISMATCH', result.productionRequestHash,
  );
  if (result.frameResults.length !== request.frames.length) throw new PoseClipProductionIntegrityError(
    'FRAME_RESULT_COUNT_MISMATCH', `Expected ${request.frames.length}, received ${result.frameResults.length}`,
  );
  for (const [index, frameResult] of result.frameResults.entries()) {
    const job = request.frames[index]!;
    if (
      frameResult.frameIndex !== index
      || frameResult.frameJobHash !== job.frameJobHash
      || frameResult.frameSpecHash !== job.spec.frameSpecHash
      || frameResult.generationInputHash !== job.generationRequest.inputHash
    ) throw new PoseClipProductionIntegrityError('FRAME_RESULT_BINDING_MISMATCH', `Frame ${index}`);
    for (const requiredAnchor of job.spec.requiredAnchors) {
      if (!hasRequiredAnchor(frameResult.poseFrame.anchors, requiredAnchor)) {
        throw new PoseClipProductionIntegrityError(
          'REQUIRED_POSE_FRAME_ANCHOR_MISSING',
          `Frame ${index} is missing ${requiredAnchor}`,
        );
      }
    }
    for (const artifact of frameResult.artifacts) {
      const {outputHash: _outputHash, ...artifactPayload} = artifact;
      if (await hashPoseFrameArtifactPayload(artifactPayload) !== artifact.outputHash) throw new PoseClipProductionIntegrityError(
        'FRAME_ARTIFACT_HASH_MISMATCH', `Frame ${index} stage ${artifact.stage}`,
      );
    }
    const {resultHash: _frameResultHash, ...framePayload} = frameResult;
    if (await hashPoseClipFrameProductionResultPayload(framePayload) !== frameResult.resultHash) {
      throw new PoseClipProductionIntegrityError('FRAME_RESULT_HASH_MISMATCH', `Frame ${index}`);
    }
    const expectedFrame = {
      assetId: job.spec.output.assetId,
      durationFrames: job.spec.durationFrames,
      anchors: frameResult.poseFrame.anchors,
      contact: {type: job.spec.contact},
      referenceFoot: job.spec.referenceFoot,
    };
    if (canonicalizeJson(frameResult.poseFrame) !== canonicalizeJson(expectedFrame)) throw new PoseClipProductionIntegrityError(
      'POSE_FRAME_SPEC_MISMATCH', `Frame ${index}`,
    );
  }
  const expectedClip = {
    id: request.poseClipId,
    entityType: request.entityType,
    action: request.action,
    loop: request.loop,
    direction: request.direction,
    frames: result.frameResults.map(({poseFrame}) => poseFrame),
    rootMotion: request.rootMotion,
    groundLock: request.groundLock,
    ...(request.tags === undefined ? {} : {tags: request.tags}),
    ...(request.compositeSlots === undefined ? {} : {compositeSlots: request.compositeSlots}),
  };
  if (canonicalizeJson(result.poseClip) !== canonicalizeJson(expectedClip)) throw new PoseClipProductionIntegrityError(
    'POSE_CLIP_ASSEMBLY_MISMATCH', result.poseClip.id,
  );
  if (await hashPoseClipContent(result.poseClip) !== result.poseClipHash) throw new PoseClipProductionIntegrityError(
    'POSE_CLIP_HASH_MISMATCH', result.poseClip.id,
  );
  if (result.qa.productionReady && result.frameResults.some(({qa}) => !qa.productionReady)) {
    throw new PoseClipProductionIntegrityError('FRAME_QA_NOT_READY', result.poseClip.id);
  }
  if (request.loop && result.qa.productionReady && result.qa.loopClosure !== 'passed') throw new PoseClipProductionIntegrityError(
    'LOOP_CLOSURE_NOT_PASSED', result.poseClip.id,
  );
  if (request.loop && result.qa.loopClosure === 'not-applicable') throw new PoseClipProductionIntegrityError(
    'LOOP_CLOSURE_REQUIRED', result.poseClip.id,
  );
  if (!request.loop && result.qa.loopClosure !== 'not-applicable') throw new PoseClipProductionIntegrityError(
    'LOOP_CLOSURE_MUST_BE_NOT_APPLICABLE', result.poseClip.id,
  );
  const {resultHash: _resultHash, ...resultPayload} = result;
  if (await hashPoseClipProductionResultPayload(resultPayload) !== result.resultHash) throw new PoseClipProductionIntegrityError(
    'PRODUCTION_RESULT_HASH_MISMATCH', result.poseClip.id,
  );
  return result;
}

export type PoseFramePhase = z.infer<typeof PoseFramePhaseSchema>;
export type PoseAnchorRequirement = z.infer<typeof PoseAnchorRequirementSchema>;
export type PoseClipFrameSpecPayload = z.infer<typeof PoseClipFrameSpecPayloadSchema>;
export type PoseClipFrameSpec = z.infer<typeof PoseClipFrameSpecSchema>;
export type PoseClipFrameJobPayload = z.infer<typeof PoseClipFrameJobPayloadSchema>;
export type PoseClipFrameJob = z.infer<typeof PoseClipFrameJobSchema>;
export type PoseClipProductionRequestPayload = z.infer<typeof PoseClipProductionRequestPayloadSchema>;
export type PoseClipProductionRequest = z.infer<typeof PoseClipProductionRequestSchema>;
export type PoseProductionDiagnostic = z.infer<typeof PoseProductionDiagnosticSchema>;
export type PoseFrameProductionQa = z.infer<typeof PoseFrameProductionQaSchema>;
export type PoseFrameArtifactStage = z.infer<typeof PoseFrameArtifactStageSchema>;
export type ProductionVisualAsset = z.infer<typeof ProductionVisualAssetSchema>;
export type PoseFrameArtifact = z.infer<typeof PoseFrameArtifactSchema>;
export type PoseClipFrameProductionResult = z.infer<typeof PoseClipFrameProductionResultSchema>;
export type PoseClipProductionQa = z.infer<typeof PoseClipProductionQaSchema>;
export type PoseClipProductionResultPayload = z.infer<typeof PoseClipProductionResultPayloadSchema>;
export type PoseClipProductionResult = z.infer<typeof PoseClipProductionResultSchema>;
