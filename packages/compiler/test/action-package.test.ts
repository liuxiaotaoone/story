import {describe, expect, it} from 'vitest';
import {
  ActionPackageSchema,
  type AssetManifest,
  type EntityDefinition,
  type PoseClip,
} from '@pose-clip/schemas';
import {
  ActionPackageIntegrityError,
  actionPackageToCapability,
  assertActionPackageIntegrity,
  assertActionPackageTargetCompatibility,
  hashActionPackagePayload,
  hashPoseClipContent,
  resolveOwnershipEventFrame,
} from '../src/index.js';
import golden from './golden/farmer.pickup-rabbit.action-package.json' with {type: 'json'};

const HASH = '1'.repeat(64);
const frameAsset = (id: string) => ({
  id,
  kind: 'character-frame' as const,
  uri: `${id}.png`,
  contentHash: HASH,
  source: 'manual' as const,
  qaStatus: 'passed' as const,
  width: 768,
  height: 1024,
  alphaMode: 'straight' as const,
});

const assets: AssetManifest = {
  schemaVersion: '1.0.0',
  assets: [
    frameAsset('farmer.pickup-rabbit.right.01'),
    frameAsset('farmer.pickup-rabbit.right.02'),
    frameAsset('farmer.pickup-rabbit.reference'),
  ],
};

const poseClip: PoseClip = {
  id: 'farmer.pickup-rabbit.right',
  entityType: 'farmer',
  action: 'pickup',
  loop: false,
  direction: 'right',
  frames: [
    {
      assetId: 'farmer.pickup-rabbit.right.01',
      durationFrames: 15,
      anchors: {foot: {x: 0.5, y: 0.96}, center: {x: 0.5, y: 0.5}},
      contact: {type: 'both'},
    },
    {
      assetId: 'farmer.pickup-rabbit.right.02',
      durationFrames: 15,
      anchors: {foot: {x: 0.5, y: 0.96}, center: {x: 0.5, y: 0.5}},
      contact: {type: 'both'},
    },
  ],
  rootMotion: {mode: 'timeline'},
  groundLock: {mode: 'always', maxCorrectionPx: 8},
  compositeSlots: [{id: 'rabbit', entityType: 'rabbit'}],
};

const actorDefinition: EntityDefinition = {
  id: 'farmer-definition',
  entityType: 'farmer',
  displayName: 'Farmer',
  poseClipIds: ['farmer.pickup-rabbit.right'],
  defaultPoseClipId: 'farmer.pickup-rabbit.right',
  attachmentSlots: [{id: 'baked-rabbit', ownerAnchor: 'center'}],
};

const targetDefinition: EntityDefinition = {
  id: 'rabbit-definition',
  entityType: 'rabbit',
  displayName: 'Rabbit',
  poseClipIds: ['rabbit.idle'],
  defaultPoseClipId: 'rabbit.idle',
  attachmentSlots: [],
  interactionAnchors: [{id: 'pickup', groundOffset: {u: 0, v: 0}}],
};

const references = {assets, poseClips: [poseClip], actorDefinition, targetDefinitions: [targetDefinition]};

describe('M3 Action Package Contract', () => {
  it('verifies the frozen Pickup package and deterministically adapts it to ActionCapability', async () => {
    const actionPackage = await assertActionPackageIntegrity(golden, references, {mode: 'production'});
    const capability = await actionPackageToCapability(actionPackage, references, {mode: 'production'});
    expect(capability).toEqual({
      action: 'pickup',
      requiredPoseClips: ['farmer.pickup-rabbit.right'],
      poseBindings: [{direction: 'right', poseClipId: 'farmer.pickup-rabbit.right'}],
      targetPolicy: 'required',
      targetTypes: ['rabbit'],
      minDurationFrames: 30,
      supportsDirections: ['right'],
      defaultDirection: 'right',
      completionPolicy: 'hold',
      spatialMode: 'stationary',
      attachmentMode: 'baked',
      interaction: golden.interaction,
    });
  });

  it('rejects hash drift, missing assets, mismatched variants and missing composite slots', async () => {
    await expect(assertActionPackageIntegrity(
      {...golden, duration: {minDurationFrames: 31}},
      references,
      {mode: 'experiment'},
    )).rejects.toThrow(/does not match packageHash/);

    const {packageHash: _packageHash, ...payload} = golden;
    const missingAssetPayload = {
      ...payload,
      requiredAssets: payload.requiredAssets.filter(asset => asset.assetId !== 'farmer.pickup-rabbit.right.02'),
    };
    const missingAsset = {
      ...missingAssetPayload,
      packageHash: await hashActionPackagePayload(missingAssetPayload),
    };
    await expect(assertActionPackageIntegrity(missingAsset, references, {mode: 'experiment'}))
      .rejects.toThrow(/uses undeclared asset/);

    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      poseClips: [{...poseClip, direction: 'left'}],
    }, {mode: 'experiment'})).rejects.toThrow(/does not match PoseClip/);

    const noCompositeClip = {...poseClip, compositeSlots: []};
    const noCompositePoseClipHash = await hashPoseClipContent(noCompositeClip);
    const noCompositePayload = {
      ...payload,
      variants: payload.variants.map(variant => ({
        ...variant,
        poseClipHash: variant.poseClipId === noCompositeClip.id
          ? noCompositePoseClipHash
          : variant.poseClipHash,
      })),
    };
    const noCompositePackage = {
      ...noCompositePayload,
      packageHash: await hashActionPackagePayload(noCompositePayload),
    };
    await expect(assertActionPackageIntegrity(noCompositePackage, {
      ...references,
      poseClips: [noCompositeClip],
    }, {mode: 'experiment'})).rejects.toThrow(/lacks composite slot/);
  });

  it('rejects invalid target policy and QA claims at the Schema boundary', () => {
    expect(ActionPackageSchema.safeParse({...golden, targetPolicy: 'none'}).success).toBe(false);
    expect(ActionPackageSchema.safeParse({
      ...golden,
      qa: {...golden.qa, continuity: 'warning'},
    }).success).toBe(false);
    expect(new ActionPackageIntegrityError('TEST', 'x')).toBeInstanceOf(Error);
  });

  it('binds package identity to asset bytes and complete PoseClip semantics', async () => {
    const changedAssetManifest: AssetManifest = {
      ...assets,
      assets: assets.assets.map((asset, index) => index === 0 ? {...asset, contentHash: '3'.repeat(64)} : asset),
    };
    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      assets: changedAssetManifest,
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_ASSET_CONTENT_MISMATCH/);

    const changedPoseClip = {
      ...poseClip,
      frames: poseClip.frames.map((frame, index) => index === 0
        ? {...frame, durationFrames: frame.durationFrames + 1}
        : frame),
    };
    expect(await hashPoseClipContent(changedPoseClip)).not.toBe(golden.variants[0]?.poseClipHash);
    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      poseClips: [changedPoseClip],
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_POSE_CLIP_CONTENT_MISMATCH/);
  });

  it('enforces production readiness, runtime asset QA and actor slot compatibility', async () => {
    const {packageHash: _packageHash, ...payload} = golden;
    const experimentalPayload = {...payload, qa: {...payload.qa, productionReady: false}};
    const experimentalPackage = {
      ...experimentalPayload,
      packageHash: await hashActionPackagePayload(experimentalPayload),
    };
    await expect(actionPackageToCapability(experimentalPackage, references, {mode: 'experiment'})).resolves.toBeDefined();
    await expect(actionPackageToCapability(experimentalPackage, references, {mode: 'production'}))
      .rejects.toThrow(/ACTION_PACKAGE_NOT_PRODUCTION_READY/);

    const failedAssets: AssetManifest = {
      ...assets,
      assets: assets.assets.map((asset, index) => index === 0 ? {...asset, qaStatus: 'failed' as const} : asset),
    };
    await expect(actionPackageToCapability(golden, {...references, assets: failedAssets}, {mode: 'experiment'})).resolves.toBeDefined();
    await expect(actionPackageToCapability(golden, {...references, assets: failedAssets}, {mode: 'production'}))
      .rejects.toThrow(/ACTION_PACKAGE_NOT_PRODUCTION_READY/);

    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      actorDefinition: {...actorDefinition, attachmentSlots: []},
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_ACTOR_SLOT_MISSING/);
  });

  it('requires the Actor Definition to declare every variant PoseClip', async () => {
    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      actorDefinition: {
        ...actorDefinition,
        poseClipIds: ['farmer.idle'],
        defaultPoseClipId: 'farmer.idle',
      },
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_ACTOR_POSE_CLIP_MISSING/);
  });

  it('validates target type and interaction anchors before Compiler entry', async () => {
    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      targetDefinitions: [{...targetDefinition, interactionAnchors: []}],
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_TARGET_ANCHOR_MISSING/);

    await expect(assertActionPackageIntegrity(golden, {
      ...references,
      targetDefinitions: [],
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_TARGET_DEFINITION_REQUIRED/);

    expect(() => assertActionPackageTargetCompatibility(golden, {
      ...targetDefinition,
      id: 'box-definition',
      entityType: 'box',
    })).toThrow(/ACTION_PACKAGE_TARGET_TYPE_UNSUPPORTED/);
  });

  it('requires targetTypes to be a non-empty unique set', () => {
    expect(ActionPackageSchema.safeParse({...golden, targetTypes: []}).success).toBe(false);
    expect(ActionPackageSchema.safeParse({...golden, targetTypes: ['rabbit', 'rabbit']}).success).toBe(false);
    expect(ActionPackageSchema.safeParse({
      ...golden,
      targetRequirements: [{entityType: 'rabbit', interactionAnchors: ['wrong-anchor']}],
    }).success).toBe(false);
  });

  it('limits v1 baked ownership to one target type and requires exact Composite Slot type', async () => {
    expect(ActionPackageSchema.safeParse({
      ...golden,
      targetTypes: ['rabbit', 'box'],
      targetRequirements: [
        ...golden.targetRequirements,
        {entityType: 'box', interactionAnchors: ['pickup']},
      ],
    }).success).toBe(false);

    const {packageHash: _packageHash, ...payload} = golden;
    const mismatchedClip = {
      ...poseClip,
      compositeSlots: [{id: 'rabbit', entityType: 'box'}],
    };
    const mismatchedPoseClipHash = await hashPoseClipContent(mismatchedClip);
    const mismatchedPayload = {
      ...payload,
      variants: payload.variants.map(variant => ({
        ...variant,
        poseClipHash: mismatchedPoseClipHash,
      })),
    };
    const mismatchedPackage = {
      ...mismatchedPayload,
      packageHash: await hashActionPackagePayload(mismatchedPayload),
    };
    await expect(assertActionPackageIntegrity(mismatchedPackage, {
      ...references,
      poseClips: [mismatchedClip],
    }, {mode: 'experiment'})).rejects.toThrow(/ACTION_PACKAGE_COMPOSITE_TARGET_MISMATCH/);
  });

  it('enforces role/kind pairs and requires every PoseClip frame to be a pose-frame output', async () => {
    expect(ActionPackageSchema.safeParse({
      ...golden,
      requiredAssets: [{
        assetId: 'voice', contentHash: HASH, kind: 'audio', role: 'pose-frame',
      }],
    }).success).toBe(false);

    const {packageHash: _packageHash, ...payload} = golden;
    const wrongRolePayload = {
      ...payload,
      requiredAssets: payload.requiredAssets.map((asset, index) => index === 0
        ? {...asset, role: 'reference' as const}
        : asset),
    };
    const wrongRolePackage = {
      ...wrongRolePayload,
      packageHash: await hashActionPackagePayload(wrongRolePayload),
    };
    await expect(assertActionPackageIntegrity(wrongRolePackage, references, {mode: 'experiment'}))
      .rejects.toThrow(/ACTION_PACKAGE_POSE_FRAME_ROLE_INVALID/);
  });

  it('defines action-end as the final active frame of a half-open SolvedAction range', () => {
    expect(resolveOwnershipEventFrame('action-start', {startFrame: 30, endFrame: 60})).toBe(30);
    expect(resolveOwnershipEventFrame('action-end', {startFrame: 30, endFrame: 60})).toBe(59);
  });
});
