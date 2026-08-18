import {z} from 'zod';
import {
  ContentHashSchema,
  IdSchema,
  ProducerRefSchema,
} from './common.js';
import {
  PoseClipContinuityQaSpecSchema,
  assertPoseClipContinuityQaSpecIntegrity,
} from './pose-clip-continuity.js';
import {canonicalHash} from './hash.js';
import {
  PoseFrameProcessorSpecSchema,
  PoseFrameQaEvaluatorSpecSchema,
  assertPoseFrameProcessorSpecIntegrity,
  assertPoseFrameQaEvaluatorSpecIntegrity,
} from './pose-frame-processing.js';

export const PoseClipProductionProfileModelHashSchema = z.object({
  modelId: IdSchema,
  contentHash: ContentHashSchema,
}).strict();

const PoseClipProductionProfilePayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  profileId: IdSchema,
  approval: z.enum(['pending', 'approved', 'revoked']),
  processorSpecs: z.object({
    matted: PoseFrameProcessorSpecSchema,
    normalized: PoseFrameProcessorSpecSchema,
    anchored: PoseFrameProcessorSpecSchema,
  }).strict(),
  frameQaSpec: PoseFrameQaEvaluatorSpecSchema,
  continuityQaSpec: PoseClipContinuityQaSpecSchema,
  executor: ProducerRefSchema,
  modelHashes: z.array(PoseClipProductionProfileModelHashSchema).min(1),
  frameExecutionKeys: z.array(ContentHashSchema).min(2),
} as const;

function hasModel(
  models: readonly z.infer<typeof PoseClipProductionProfileModelHashSchema>[],
  required: {modelId: string; contentHash: string},
): boolean {
  return models.some((model) => model.modelId === required.modelId && model.contentHash === required.contentHash);
}

function refineProductionProfile(
  profile: z.output<z.ZodObject<typeof PoseClipProductionProfilePayloadShape>>,
  context: z.RefinementCtx,
): void {
  const stages = ['matted', 'normalized', 'anchored'] as const;
  for (const stage of stages) {
    if (profile.processorSpecs[stage].stage !== stage) context.addIssue({
      code: 'custom',
      message: `Production profile processor spec must be ${stage}`,
      path: ['processorSpecs', stage, 'stage'],
    });
  }
  const modelIds = new Set<string>();
  for (const [index, model] of profile.modelHashes.entries()) {
    if (modelIds.has(model.modelId)) context.addIssue({
      code: 'custom',
      message: `Production profile contains duplicate model ${model.modelId}`,
      path: ['modelHashes', index, 'modelId'],
    });
    modelIds.add(model.modelId);
  }
  for (const [index, frameExecutionKey] of profile.frameExecutionKeys.entries()) {
    if (profile.frameExecutionKeys.indexOf(frameExecutionKey) !== index) context.addIssue({
      code: 'custom',
      message: `Production profile contains duplicate frame execution key ${frameExecutionKey}`,
      path: ['frameExecutionKeys', index],
    });
  }
}

export const PoseClipProductionProfilePayloadSchema = z.object(
  PoseClipProductionProfilePayloadShape,
).strict().superRefine(refineProductionProfile);

export const PoseClipProductionProfileSchema = z.object({
  ...PoseClipProductionProfilePayloadShape,
  profileHash: ContentHashSchema,
}).strict().superRefine(refineProductionProfile);

export class PoseClipProductionProfileIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PoseClipProductionProfileIntegrityError';
  }
}

export async function hashPoseClipProductionProfilePayload(input: unknown): Promise<string> {
  return canonicalHash(
    'pose-clip-production-profile-v1',
    PoseClipProductionProfilePayloadSchema.parse(input),
  );
}

export async function createPoseClipProductionProfile(input: unknown): Promise<PoseClipProductionProfile> {
  const payload = PoseClipProductionProfilePayloadSchema.parse(input);
  return PoseClipProductionProfileSchema.parse({
    ...payload,
    profileHash: await hashPoseClipProductionProfilePayload(payload),
  });
}

export async function assertPoseClipProductionProfileIntegrity(
  input: unknown,
): Promise<PoseClipProductionProfile> {
  const profile = PoseClipProductionProfileSchema.parse(input);
  for (const stage of ['matted', 'normalized', 'anchored'] as const) {
    await assertPoseFrameProcessorSpecIntegrity(profile.processorSpecs[stage]);
  }
  await assertPoseFrameQaEvaluatorSpecIntegrity(profile.frameQaSpec);
  await assertPoseClipContinuityQaSpecIntegrity(profile.continuityQaSpec);
  const nestedModels = [
    ...(['matted', 'normalized', 'anchored'] as const).flatMap((stage) => {
      const model = profile.processorSpecs[stage].model;
      return model === undefined ? [] : [model];
    }),
    ...(profile.frameQaSpec.model === undefined ? [] : [profile.frameQaSpec.model]),
    ...(profile.continuityQaSpec.featureExtractor.model === undefined
      ? []
      : [profile.continuityQaSpec.featureExtractor.model]),
  ];
  for (const model of nestedModels) {
    if (!hasModel(profile.modelHashes, model)) throw new PoseClipProductionProfileIntegrityError(
      'PRODUCTION_PROFILE_MODEL_NOT_ADMITTED',
      model.modelId,
    );
  }
  const {profileHash: _profileHash, ...payload} = profile;
  if (await hashPoseClipProductionProfilePayload(payload) !== profile.profileHash) {
    throw new PoseClipProductionProfileIntegrityError(
      'PRODUCTION_PROFILE_HASH_MISMATCH',
      profile.profileId,
    );
  }
  return profile;
}

export function productionProfileAdmitsModel(
  profile: PoseClipProductionProfile,
  model: {modelId: string; contentHash: string},
): boolean {
  return hasModel(profile.modelHashes, model);
}

export type PoseClipProductionProfileModelHash = z.infer<typeof PoseClipProductionProfileModelHashSchema>;
export type PoseClipProductionProfilePayload = z.infer<typeof PoseClipProductionProfilePayloadSchema>;
export type PoseClipProductionProfile = z.infer<typeof PoseClipProductionProfileSchema>;
