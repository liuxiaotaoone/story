import {describe, expect, it} from 'vitest';
import {
  ActionPackageSchema,
  type AssetManifest,
  type PoseClip,
} from '@pose-clip/schemas';
import {
  ActionPackageIntegrityError,
  actionPackageToCapability,
  assertActionPackageIntegrity,
  hashActionPackagePayload,
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

describe('M3 Action Package Contract', () => {
  it('verifies the frozen Pickup package and deterministically adapts it to ActionCapability', async () => {
    const actionPackage = await assertActionPackageIntegrity(golden, {assets, poseClips: [poseClip]});
    const capability = await actionPackageToCapability(actionPackage, {assets, poseClips: [poseClip]});
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
      {assets, poseClips: [poseClip]},
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
    await expect(assertActionPackageIntegrity(missingAsset, {assets, poseClips: [poseClip]}))
      .rejects.toThrow(/uses undeclared asset/);

    await expect(assertActionPackageIntegrity(golden, {
      assets,
      poseClips: [{...poseClip, direction: 'left'}],
    })).rejects.toThrow(/does not match PoseClip/);

    await expect(assertActionPackageIntegrity(golden, {
      assets,
      poseClips: [{...poseClip, compositeSlots: []}],
    })).rejects.toThrow(/lacks composite slot/);
  });

  it('rejects invalid target policy and QA claims at the Schema boundary', () => {
    expect(ActionPackageSchema.safeParse({...golden, targetPolicy: 'none'}).success).toBe(false);
    expect(ActionPackageSchema.safeParse({
      ...golden,
      qa: {...golden.qa, continuity: 'warning'},
    }).success).toBe(false);
    expect(new ActionPackageIntegrityError('x')).toBeInstanceOf(Error);
  });

  it('defines action-end as the final active frame of a half-open SolvedAction range', () => {
    expect(resolveOwnershipEventFrame('action-start', {startFrame: 30, endFrame: 60})).toBe(30);
    expect(resolveOwnershipEventFrame('action-end', {startFrame: 30, endFrame: 60})).toBe(59);
  });
});
