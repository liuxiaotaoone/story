import {
  ActionCapabilitySchema,
  ActionPackagePayloadSchema,
  ActionPackageSchema,
  AssetManifestSchema,
  EntityDefinitionSchema,
  PoseClipSchema,
  canonicalHash,
  type ActionCapability,
  type ActionPackage,
  type AssetManifest,
  type EntityDefinition,
  type PoseClip,
} from '@pose-clip/schemas';

export class ActionPackageIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionPackageIntegrityError';
    this.code = code;
  }
}

function integrityError(code: string, message: string): never {
  throw new ActionPackageIntegrityError(code, `${code}: ${message}`);
}

export async function hashActionPackagePayload(input: unknown): Promise<string> {
  return canonicalHash('action-package-v1', ActionPackagePayloadSchema.parse(input));
}

export async function assertActionPackageHash(input: unknown): Promise<ActionPackage> {
  const actionPackage = ActionPackageSchema.parse(input);
  const {packageHash: _packageHash, ...payload} = actionPackage;
  const computed = await hashActionPackagePayload(payload);
  if (computed !== actionPackage.packageHash) {
    integrityError('ACTION_PACKAGE_HASH_MISMATCH', `Action Package ${actionPackage.id} content does not match packageHash`);
  }
  return actionPackage;
}

export async function hashPoseClipContent(input: unknown): Promise<string> {
  return canonicalHash('pose-clip-v1', PoseClipSchema.parse(input));
}

export interface ActionPackageReferences {
  assets: AssetManifest;
  poseClips: readonly PoseClip[];
  actorDefinition?: EntityDefinition;
}

export interface ActionPackageResolutionOptions {
  mode: 'experiment' | 'production';
}

export function assertActionPackageCompatibility(
  actionPackageInput: ActionPackage,
  actorDefinitionInput: unknown,
): EntityDefinition {
  const actionPackage = ActionPackageSchema.parse(actionPackageInput);
  const actorDefinition = EntityDefinitionSchema.parse(actorDefinitionInput);
  if (actorDefinition.entityType !== actionPackage.entityType) integrityError(
    'ACTION_PACKAGE_ACTOR_TYPE_MISMATCH',
    `Actor definition ${actorDefinition.id} has type ${actorDefinition.entityType}; expected ${actionPackage.entityType}`,
  );
  const actorSlots = new Set(actorDefinition.attachmentSlots.map(slot => slot.id));
  for (const slot of actionPackage.actorRequirements?.attachmentSlots ?? []) {
    if (!actorSlots.has(slot)) integrityError(
      'ACTION_PACKAGE_ACTOR_SLOT_MISSING',
      `Actor definition ${actorDefinition.id} lacks required attachment slot ${slot}`,
    );
  }
  return actorDefinition;
}

export async function assertActionPackageIntegrity(
  input: unknown,
  references: ActionPackageReferences,
  options: ActionPackageResolutionOptions,
): Promise<ActionPackage> {
  const actionPackage = await assertActionPackageHash(input);
  const assets = AssetManifestSchema.parse(references.assets);
  const poseClips = references.poseClips.map(clip => PoseClipSchema.parse(clip));
  const assetById = new Map(assets.assets.map(asset => [asset.id, asset]));
  const clipById = new Map(poseClips.map(clip => [clip.id, clip]));
  const requirementById = new Map(actionPackage.requiredAssets.map(asset => [asset.assetId, asset]));

  if (options.mode === 'production' && !actionPackage.qa.productionReady) integrityError(
    'ACTION_PACKAGE_NOT_PRODUCTION_READY',
    `Action Package ${actionPackage.id} is not productionReady`,
  );

  for (const requirement of actionPackage.requiredAssets) {
    const asset = assetById.get(requirement.assetId);
    if (asset === undefined) integrityError(
      'ACTION_PACKAGE_ASSET_MISSING',
      `Action Package ${actionPackage.id} requires missing asset ${requirement.assetId}`,
    );
    if (asset.kind !== requirement.kind) integrityError(
      'ACTION_PACKAGE_ASSET_KIND_MISMATCH',
      `Action Package ${actionPackage.id} asset ${requirement.assetId} kind ${asset.kind} does not match ${requirement.kind}`,
    );
    if (asset.contentHash !== requirement.contentHash) integrityError(
      'ACTION_PACKAGE_ASSET_CONTENT_MISMATCH',
      `Action Package ${actionPackage.id} asset ${requirement.assetId} contentHash does not match its manifest`,
    );
    if (options.mode === 'production' && requirement.role !== 'reference' && asset.qaStatus !== 'passed') integrityError(
      'ACTION_PACKAGE_NOT_PRODUCTION_READY',
      `Runtime asset ${requirement.assetId} has qaStatus=${asset.qaStatus}`,
    );
  }

  for (const variant of actionPackage.variants) {
    const clip = clipById.get(variant.poseClipId);
    if (clip === undefined) integrityError(
      'ACTION_PACKAGE_POSE_CLIP_MISSING',
      `Action Package ${actionPackage.id} references missing PoseClip ${variant.poseClipId}`,
    );
    if (clip.entityType !== actionPackage.entityType || clip.action !== actionPackage.action || clip.direction !== variant.direction) {
      integrityError(
        'ACTION_PACKAGE_POSE_CLIP_MISMATCH',
        `Action Package ${actionPackage.id} variant ${variant.direction} does not match PoseClip ${variant.poseClipId}`,
      );
    }
    if (await hashPoseClipContent(clip) !== variant.poseClipHash) integrityError(
      'ACTION_PACKAGE_POSE_CLIP_CONTENT_MISMATCH',
      `Action Package ${actionPackage.id} PoseClip ${clip.id} contentHash does not match`,
    );
    for (const frame of clip.frames) {
      const requirement = requirementById.get(frame.assetId);
      if (requirement === undefined) integrityError(
        'ACTION_PACKAGE_POSE_FRAME_UNDECLARED',
        `Action Package ${actionPackage.id} PoseClip ${clip.id} uses undeclared asset ${frame.assetId}`,
      );
      if (requirement.role !== 'pose-frame') integrityError(
        'ACTION_PACKAGE_POSE_FRAME_ROLE_INVALID',
        `Action Package ${actionPackage.id} PoseClip ${clip.id} asset ${frame.assetId} must have role=pose-frame`,
      );
    }
    const ownership = actionPackage.interaction?.ownership;
    if (ownership !== undefined) {
      const compositeSlot = clip.compositeSlots?.find(slot => slot.id === ownership.compositeSlotId);
      if (compositeSlot === undefined) integrityError(
        'ACTION_PACKAGE_COMPOSITE_SLOT_MISSING',
        `Action Package ${actionPackage.id} PoseClip ${clip.id} lacks composite slot ${ownership.compositeSlotId}`,
      );
      if (!(actionPackage.targetTypes ?? []).includes(compositeSlot.entityType)) integrityError(
        'ACTION_PACKAGE_COMPOSITE_TARGET_UNSUPPORTED',
        `Action Package ${actionPackage.id} composite slot ${compositeSlot.id} has unsupported target type ${compositeSlot.entityType}`,
      );
    }
  }
  if ((actionPackage.actorRequirements?.attachmentSlots.length ?? 0) > 0) {
    if (references.actorDefinition === undefined) integrityError(
      'ACTION_PACKAGE_ACTOR_DEFINITION_REQUIRED',
      `Action Package ${actionPackage.id} requires an actor EntityDefinition for compatibility validation`,
    );
    assertActionPackageCompatibility(actionPackage, references.actorDefinition);
  }
  return actionPackage;
}

export async function actionPackageToCapability(
  input: unknown,
  references: ActionPackageReferences,
  options: ActionPackageResolutionOptions,
): Promise<ActionCapability> {
  const actionPackage = await assertActionPackageIntegrity(input, references, options);
  return ActionCapabilitySchema.parse({
    action: actionPackage.action,
    requiredPoseClips: actionPackage.variants.map(variant => variant.poseClipId),
    poseBindings: actionPackage.variants.map(variant => ({
      direction: variant.direction,
      poseClipId: variant.poseClipId,
    })),
    targetPolicy: actionPackage.targetPolicy,
    ...(actionPackage.targetTypes === undefined ? {} : {targetTypes: actionPackage.targetTypes}),
    minDurationFrames: actionPackage.duration.minDurationFrames,
    supportsDirections: actionPackage.variants.map(variant => variant.direction),
    defaultDirection: actionPackage.defaultDirection,
    completionPolicy: actionPackage.completionPolicy,
    spatialMode: actionPackage.spatialMode,
    ...(actionPackage.attachmentMode === undefined ? {} : {attachmentMode: actionPackage.attachmentMode}),
    ...(actionPackage.interaction === undefined ? {} : {interaction: actionPackage.interaction}),
  });
}
