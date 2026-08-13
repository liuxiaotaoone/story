import {describe, expect, it} from 'vitest';
import {
  CapabilityCatalogSchema,
  FinalCompileInputSchema,
  type ResolvedAssetCatalog,
} from '@pose-clip/schemas';
import {
  CompileIntegrityError,
  assertRequiredPoseClipsResolved,
  compilePreflight,
  createEffectiveDirectorPlan,
  optionalActionDropDiagnostics,
} from '../src/index.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';

const HASH = '0'.repeat(64);

function visualAsset(id: string) {
  return {
    id, kind: 'animal-frame' as const, uri: `${id}.png`, contentHash: HASH,
    source: 'manual' as const, qaStatus: 'passed' as const,
    width: 512, height: 512, alphaMode: 'straight' as const,
  };
}

function poseClip(id: string, entityType = 'rabbit', action = 'run', direction: 'left' | 'right' = 'left') {
  return {
    id, entityType, action, loop: true, direction,
    frames: [{
      assetId: `${id}.frame`, durationFrames: 3,
      anchors: {foot: {x: 0.5, y: 0.95}, center: {x: 0.5, y: 0.5}},
    }],
    rootMotion: {mode: 'timeline' as const},
    groundLock: {mode: 'always' as const, maxCorrectionPx: 4},
  };
}

function bindingCatalog(clipId = 'rabbit.run-left'): ResolvedAssetCatalog {
  const rabbitClip = poseClip(clipId);
  const farmerClip = poseClip('farmer.notice-right', 'farmer', 'notice', 'right');
  return {
    schemaVersion: '1.0.0', mode: 'experiment', productionReady: false, catalogHash: HASH,
    assets: {schemaVersion: '1.0.0', assets: [visualAsset(`${clipId}.frame`), {...visualAsset('farmer.notice-right.frame'), kind: 'character-frame' as const}]},
    poseClips: [rabbitClip, farmerClip], environments: [],
    entityDefinitions: [{
      id: 'rabbit-definition', entityType: 'rabbit', displayName: 'Rabbit',
      poseClipIds: [clipId], defaultPoseClipId: clipId, attachmentSlots: [],
    }, {
      id: 'farmer-definition', entityType: 'farmer', displayName: 'Farmer',
      poseClipIds: ['farmer.notice-right'], defaultPoseClipId: 'farmer.notice-right', attachmentSlots: [],
    }],
    characterBindings: [
      {characterId: 'rabbit', entityDefinitionId: 'rabbit-definition'},
      {characterId: 'farmer', entityDefinitionId: 'farmer-definition'},
    ],
  };
}

describe('Final Compiler input and asset binding hardening', () => {
  it('rejects Capability actions whose required clips are undeclared by their entity', () => {
    const rabbit = capabilityCatalog.entityCapabilities[0]!;
    expect(CapabilityCatalogSchema.safeParse({
      ...capabilityCatalog,
      entityCapabilities: [{...rabbit, poseClips: ['rabbit.idle']}],
    }).success).toBe(false);
  });

  it('requires exact PoseClip ids even when a semantically similar clip exists', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    expect(() => assertRequiredPoseClipsResolved(effective, preflight, bindingCatalog('rabbit.run-similar')))
      .toThrow(/Required PoseClip rabbit\.run-left does not exist/u);
  });

  it('requires explicit Character binding, matching entityType and EntityDefinition declaration', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const missing = bindingCatalog();
    missing.characterBindings = missing.characterBindings.filter(binding => binding.characterId !== 'rabbit');
    expect(() => assertRequiredPoseClipsResolved(effective, preflight, missing)).toThrow(/no explicit asset binding/u);

    const extra = bindingCatalog();
    extra.characterBindings.push({characterId: 'ghost', entityDefinitionId: 'rabbit-definition'});
    expect(() => assertRequiredPoseClipsResolved(effective, preflight, extra)).toThrow(/unknown Director character/u);

    const wrongType = bindingCatalog();
    wrongType.entityDefinitions[0] = {...wrongType.entityDefinitions[0]!, entityType: 'farmer'};
    expect(() => assertRequiredPoseClipsResolved(effective, preflight, wrongType)).toThrow(/entityType does not match/u);

    const undeclared = bindingCatalog();
    undeclared.entityDefinitions[0] = {
      ...undeclared.entityDefinitions[0]!,
      poseClipIds: ['rabbit.other'], defaultPoseClipId: 'rabbit.other',
    };
    expect(() => assertRequiredPoseClipsResolved(effective, preflight, undeclared)).toThrow(/does not declare required PoseClip/u);
  });

  it('requires explicit deterministic FinalCompileContext fields', () => {
    expect(FinalCompileInputSchema.safeParse({}).success).toBe(false);
    const context = {seed: 42, compilerVersion: '0.1.0', compiledAt: '2026-08-12T00:00:00.000Z'};
    expect(FinalCompileInputSchema.shape.context.safeParse(context).success).toBe(true);
    expect(FinalCompileInputSchema.shape.context.safeParse({...context, seed: 1.5}).success).toBe(false);
    expect(FinalCompileInputSchema.shape.context.safeParse({...context, compilerVersion: 'dev'}).success).toBe(false);
    expect(FinalCompileInputSchema.shape.context.safeParse({...context, compiledAt: 'now'}).success).toBe(false);
  });

  it('drops optional actions explicitly with stable diagnostics', () => {
    const required = {
      id: 'expanded.required', sourceActionId: 'required', sceneId: 'scene', shotId: 'shot', actorId: 'rabbit',
      action: 'run', sequence: 0, direction: 'left' as const, priority: 'required' as const,
      targetPolicy: 'none' as const,
      minDurationFrames: 10, poseClipId: 'rabbit.run-left', requiredPoseClipIds: ['rabbit.run-left'],
      completionPolicy: 'return-default' as const, spatialMode: 'locomotion' as const,
      destinationBlocking: {horizontal: 'left' as const, depth: 'ground' as const},
    };
    const optional = {...required, id: 'expanded.optional', sourceActionId: 'optional', priority: 'optional' as const};
    expect(optionalActionDropDiagnostics([required, optional])).toEqual([expect.objectContaining({
      id: 'diagnostic.expanded.optional.optional-dropped',
      code: 'OPTIONAL_ACTION_DROPPED', severity: 'info', sourceId: 'optional',
    })]);
  });

  it('does not apply the exact PoseClip asset gate to optional actions', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const optional = {
      ...preflight.expandedActions[0]!, id: 'expanded.optional-wave', sourceActionId: 'optional-wave',
      actorId: 'farmer', action: 'wave', priority: 'optional' as const,
      poseClipId: 'farmer.wave-right', requiredPoseClipIds: ['farmer.wave-right'],
    };
    expect(() => assertRequiredPoseClipsResolved(
      effective,
      {...preflight, expandedActions: [...preflight.expandedActions, optional]},
      bindingCatalog(),
    )).not.toThrow();
    expect(optionalActionDropDiagnostics([optional])).toEqual([
      expect.objectContaining({code: 'OPTIONAL_ACTION_DROPPED', severity: 'info'}),
    ]);
  });
});
