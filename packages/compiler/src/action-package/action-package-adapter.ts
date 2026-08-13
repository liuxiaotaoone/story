import {
  ActionCapabilitySchema,
  ActionPackagePayloadSchema,
  ActionPackageSchema,
  AssetManifestSchema,
  PoseClipSchema,
  canonicalHash,
  type ActionCapability,
  type ActionPackage,
  type AssetManifest,
  type PoseClip,
} from '@pose-clip/schemas';

export class ActionPackageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionPackageIntegrityError';
  }
}

export async function hashActionPackagePayload(input: unknown): Promise<string> {
  return canonicalHash('action-package-v1', ActionPackagePayloadSchema.parse(input));
}

export async function assertActionPackageHash(input: unknown): Promise<ActionPackage> {
  const actionPackage = ActionPackageSchema.parse(input);
  const {packageHash: _packageHash, ...payload} = actionPackage;
  const computed = await hashActionPackagePayload(payload);
  if (computed !== actionPackage.packageHash) {
    throw new ActionPackageIntegrityError(`Action Package ${actionPackage.id} content does not match packageHash`);
  }
  return actionPackage;
}

export interface ActionPackageReferences {
  assets: AssetManifest;
  poseClips: readonly PoseClip[];
}

export async function assertActionPackageIntegrity(
  input: unknown,
  references: ActionPackageReferences,
): Promise<ActionPackage> {
  const actionPackage = await assertActionPackageHash(input);
  const assets = AssetManifestSchema.parse(references.assets);
  const poseClips = references.poseClips.map(clip => PoseClipSchema.parse(clip));
  const assetById = new Map(assets.assets.map(asset => [asset.id, asset]));
  const clipById = new Map(poseClips.map(clip => [clip.id, clip]));
  const declaredAssetIds = new Set(actionPackage.requiredAssets.map(asset => asset.assetId));

  for (const requirement of actionPackage.requiredAssets) {
    const asset = assetById.get(requirement.assetId);
    if (asset === undefined) throw new ActionPackageIntegrityError(
      `Action Package ${actionPackage.id} requires missing asset ${requirement.assetId}`,
    );
    if (asset.kind !== requirement.kind) throw new ActionPackageIntegrityError(
      `Action Package ${actionPackage.id} asset ${requirement.assetId} kind ${asset.kind} does not match ${requirement.kind}`,
    );
  }

  for (const variant of actionPackage.variants) {
    const clip = clipById.get(variant.poseClipId);
    if (clip === undefined) throw new ActionPackageIntegrityError(
      `Action Package ${actionPackage.id} references missing PoseClip ${variant.poseClipId}`,
    );
    if (clip.entityType !== actionPackage.entityType || clip.action !== actionPackage.action || clip.direction !== variant.direction) {
      throw new ActionPackageIntegrityError(
        `Action Package ${actionPackage.id} variant ${variant.direction} does not match PoseClip ${variant.poseClipId}`,
      );
    }
    for (const frame of clip.frames) {
      if (!declaredAssetIds.has(frame.assetId)) throw new ActionPackageIntegrityError(
        `Action Package ${actionPackage.id} PoseClip ${clip.id} uses undeclared asset ${frame.assetId}`,
      );
    }
    const ownership = actionPackage.interaction?.ownership;
    if (ownership !== undefined) {
      const compositeSlot = clip.compositeSlots?.find(slot => slot.id === ownership.compositeSlotId);
      if (compositeSlot === undefined) throw new ActionPackageIntegrityError(
        `Action Package ${actionPackage.id} PoseClip ${clip.id} lacks composite slot ${ownership.compositeSlotId}`,
      );
      if (!(actionPackage.targetTypes ?? []).includes(compositeSlot.entityType)) throw new ActionPackageIntegrityError(
        `Action Package ${actionPackage.id} composite slot ${compositeSlot.id} has unsupported target type ${compositeSlot.entityType}`,
      );
    }
  }
  return actionPackage;
}

export async function actionPackageToCapability(
  input: unknown,
  references: ActionPackageReferences,
): Promise<ActionCapability> {
  const actionPackage = await assertActionPackageIntegrity(input, references);
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
