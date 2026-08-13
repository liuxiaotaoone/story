import {describe, expect, it} from 'vitest';
import {
  DirectorPlanSchema,
  assertRenderPlanIntegrity,
  canonicalHash,
  semanticRenderPlanHash,
  type FinalCompileInput,
  type MeasuredAudio,
} from '@pose-clip/schemas';
import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {
  compileFinal,
  compilePreflight,
  createEffectiveDirectorPlan,
  hashResolvedAssetCatalogPayload,
  compileActionPoseEvents,
} from '../src/index.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';

const HASH = '0'.repeat(64);
const transform = {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1};

function visualAsset(id: string, kind: 'environment-layer' | 'character-frame' | 'animal-frame') {
  return {
    id, kind, uri: `${id}.png`, contentHash: HASH, source: 'manual' as const,
    qaStatus: 'passed' as const, width: 1280, height: 720,
    alphaMode: kind === 'environment-layer' ? 'opaque' as const : 'straight' as const,
  };
}

function poseClip(id: string, entityType: string, action: string, direction: 'left' | 'right') {
  return {
    id, entityType, action, direction, loop: true,
    frames: [{
      assetId: `${id}.frame`, durationFrames: 6,
      anchors: {foot: {x: 0.5, y: 0.95}, center: {x: 0.5, y: 0.5}},
      contact: {type: 'both' as const},
    }],
    rootMotion: {mode: 'timeline' as const},
    groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
  };
}

async function finalInput(): Promise<FinalCompileInput> {
  const directorPlan = DirectorPlanSchema.parse({
    ...storyDirectorPlan,
    shots: storyDirectorPlan.shots.map((shot, index) => ({
      ...shot, durationPreference: {preferredSeconds: index === 0 ? 12 : 10},
    })),
  });
  const effectiveDirectorPlan = await createEffectiveDirectorPlan({story: sourceStory, directorPlan, overrides: []});
  const preflight = await compilePreflight({effectiveDirectorPlan, capabilityCatalog});
  const measuredAudio: MeasuredAudio[] = preflight.ttsRequests.map((request, index) => ({
    requestId: request.id, sourceTtsRequestHash: request.inputHash,
    assetId: `audio.${request.id}`, sampleRate: 48_000,
    sampleFrameCount: index === 0 ? 48_000 : 24_000, channels: 1,
    contentHash: HASH, measurementProducer: {name: 'final-test', version: '1.0.0'},
  }));
  const clips = [
    poseClip('rabbit.idle-left', 'rabbit', 'idle', 'left'),
    poseClip('rabbit.run-left', 'rabbit', 'run', 'left'),
    poseClip('farmer.idle-right', 'farmer', 'idle', 'right'),
    poseClip('farmer.notice-right', 'farmer', 'notice', 'right'),
  ];
  const assetCatalogPayload = {
    schemaVersion: '1.0.0' as const, mode: 'experiment' as const, productionReady: false,
    assets: {
      schemaVersion: '1.0.0' as const,
      assets: [
        visualAsset('field-layer', 'environment-layer'),
        visualAsset('rabbit.idle-left.frame', 'animal-frame'),
        visualAsset('rabbit.run-left.frame', 'animal-frame'),
        visualAsset('farmer.idle-right.frame', 'character-frame'),
        visualAsset('farmer.notice-right.frame', 'character-frame'),
        ...measuredAudio.map(audio => ({
          id: audio.assetId, kind: 'audio' as const, uri: `${audio.assetId}.wav`,
          contentHash: audio.contentHash, source: 'manual' as const, qaStatus: 'passed' as const,
        })),
      ],
    },
    poseClips: clips,
    environments: [{
      id: 'pastoral-field', name: 'Pastoral Field', referenceResolution: {width: 1280, height: 720},
      layers: [{id: 'field', assetId: 'field-layer', renderLayer: 'ground' as const, zIndex: 0, parallaxFactor: 0.7, transform}],
      ground: {
        farLeft: {x: 0.1, y: 0.5}, farRight: {x: 0.9, y: 0.5},
        nearLeft: {x: 0, y: 1}, nearRight: {x: 1, y: 1},
        farScale: 0.5, nearScale: 1, depthEasing: 'linear' as const, walkableZones: [],
      },
      occlusionZones: [],
    }],
    entityDefinitions: [{
      id: 'rabbit-definition', entityType: 'rabbit', displayName: 'Rabbit',
      poseClipIds: ['rabbit.idle-left', 'rabbit.run-left'], defaultPoseClipId: 'rabbit.idle-left', attachmentSlots: [],
    }, {
      id: 'farmer-definition', entityType: 'farmer', displayName: 'Farmer',
      poseClipIds: ['farmer.idle-right', 'farmer.notice-right'], defaultPoseClipId: 'farmer.idle-right', attachmentSlots: [],
    }],
    characterBindings: [
      {characterId: 'rabbit', entityDefinitionId: 'rabbit-definition'},
      {characterId: 'farmer', entityDefinitionId: 'farmer-definition'},
    ],
  };
  const assetCatalog = {
    ...assetCatalogPayload,
    catalogHash: await hashResolvedAssetCatalogPayload(assetCatalogPayload),
  };
  return {
    effectiveDirectorPlan, preflight, measuredAudio, capabilityCatalog, assetCatalog,
    context: {seed: 42, compilerVersion: '0.1.0', compiledAt: '2026-08-12T00:00:00.000Z'},
  };
}

describe('M2 Final Compiler', () => {
  it('compiles semantic input into one Renderer-ready 22-second Canonical Timeline', async () => {
    const input = await finalInput();
    const plan = await compileFinal(input);
    expect(plan.timeline.durationFrames).toBe(660);
    expect(plan.timeline.shots).toHaveLength(2);
    expect(plan.timeline.cameraTracks).toHaveLength(2);
    expect(plan.timeline.poseEvents.map(event => event.poseClipId)).toEqual([
      'rabbit.run-left', 'rabbit.idle-left', 'farmer.notice-right',
    ]);
    expect(plan.timeline.poseTransitions).toHaveLength(3);
    expect(plan.timeline.narration).toHaveLength(2);
    expect(plan.timeline.subtitles).toHaveLength(2);
    expect(plan.provenance.warnings).toContainEqual(expect.objectContaining({code: 'ACTION_REWRITTEN'}));
    expect(assertRenderPlanIntegrity(plan)).toEqual(plan);
    expect(prepareRenderPlan(plan).plan).toEqual(plan);
  });

  it('is byte-semantically deterministic for identical explicit inputs', async () => {
    const input = await finalInput();
    const first = await compileFinal(input);
    const expectedHash = await semanticRenderPlanHash(first);
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const next = await compileFinal(input);
      expect(next).toEqual(first);
      expect(await semanticRenderPlanHash(next)).toBe(expectedHash);
    }
  });

  it('executes action duration, locomotion and follow-camera semantics in RenderState', async () => {
    const plan = await compileFinal(await finalInput());
    const prepared = prepareRenderPlan(plan);
    const rabbitAt = (frame: number) => {
      const state = evaluateFrame(prepared, frame);
      const rabbit = state.sprites.find(sprite => sprite.entityId === 'rabbit');
      if (rabbit === undefined) throw new Error(`Rabbit missing at frame ${frame}`);
      return {state, rabbit};
    };
    const frame0 = rabbitAt(0);
    const frame60 = rabbitAt(60);
    const frame119 = rabbitAt(119);
    const frame120 = rabbitAt(120);
    const frame180 = rabbitAt(180);

    expect(frame0.rabbit.assetId).toBe('rabbit.run-left.frame');
    expect(frame119.rabbit.assetId).toBe('rabbit.run-left.frame');
    expect(frame120.rabbit.assetId).toBe('rabbit.idle-left.frame');
    expect(frame180.rabbit.assetId).toBe('rabbit.idle-left.frame');
    expect(frame0.rabbit.transform.position.x).toBeGreaterThan(frame60.rabbit.transform.position.x);
    expect(frame60.rabbit.transform.position.x).toBeGreaterThan(frame120.rabbit.transform.position.x);
    expect(frame120.rabbit.transform.position.x).toBe(frame180.rabbit.transform.position.x);
    for (const frame of [frame0, frame60, frame119, frame120]) {
      expect(frame.state.camera.position.x).toBeCloseTo(frame.rabbit.transform.position.x, 8);
      expect(frame.state.camera.position.y).toBeCloseTo(frame.rabbit.transform.position.y, 8);
    }
  });

  it('switches consecutive actions directly without an intermediate default PoseEvent', async () => {
    const input = await finalInput();
    const first = input.preflight.expandedActions[0]!;
    const {destinationBlocking: _destinationBlocking, ...stationaryBase} = first;
    const second = {
      ...stationaryBase, id: 'expanded.rabbit-next', sourceActionId: 'rabbit-next',
      poseClipId: 'rabbit.idle-left', requiredPoseClipIds: ['rabbit.idle-left'],
      completionPolicy: 'hold' as const, spatialMode: 'stationary' as const,
    };
    const output = compileActionPoseEvents({
      effective: input.effectiveDirectorPlan,
      preflight: {...input.preflight, expandedActions: [first, second]},
      catalog: input.assetCatalog,
      timing: {
        fps: 30, durationFrames: 180, diagnostics: [],
        shots: [{
          shotId: 'shot-run', startFrame: 0, endFrame: 180, narration: [],
          actions: [
            {expandedActionId: first.id, startFrame: 0, endFrame: 120},
            {expandedActionId: second.id, startFrame: 120, endFrame: 180},
          ],
        }],
      },
    });
    expect(output.poseEvents.filter(event => event.frame === 120)).toEqual([
      expect.objectContaining({id: 'pose.expanded.rabbit-next', poseClipId: 'rabbit.idle-left'}),
    ]);
    expect(output.poseEvents.some(event => event.id === `pose-complete.${first.id}`)).toBe(false);
  });
});

describe('M3 Visual Recovery Productization', () => {
  it('compiles landmark contact, effect cue, baked pickup and camera composition into the only Canonical RenderPlan', async () => {
    const base = await finalInput();
    const directorPlan = DirectorPlanSchema.parse({
      ...storyDirectorPlan,
      landmarks: [{id: 'stump', sceneId: 'scene-field', landmarkType: 'stump', blocking: {horizontal: 'right', depth: 'ground'}}],
      shots: storyDirectorPlan.shots.map((shot, index) => ({
        ...shot,
        durationPreference: {preferredSeconds: 5},
        composition: index === 0
          ? {subjectScreenX: 0.64, subjectScreenY: 0.72, leadRoom: 'left'}
          : {subjectScreenX: 0.44, subjectScreenY: 0.72, leadRoom: 'right'},
      })),
      actions: [
        {id: 'action-collision', sceneId: 'scene-field', shotId: 'shot-run', actorId: 'rabbit', targetId: 'stump', action: 'collision', sequence: 0, direction: 'left', priority: 'required', enabled: true},
        {id: 'action-sparkle', sceneId: 'scene-field', shotId: 'shot-run', actorId: 'rabbit', targetId: 'stump', action: 'sparkle', sequence: 1, direction: 'left', priority: 'optional', enabled: true},
        {id: 'action-pickup', sceneId: 'scene-field', shotId: 'shot-notice', actorId: 'farmer', targetId: 'rabbit', action: 'pickup', sequence: 0, direction: 'right', priority: 'required', enabled: true},
      ],
    });
    const m3Capabilities = structuredClone(capabilityCatalog);
    m3Capabilities.entityCapabilities.find(entity => entity.entityType === 'rabbit')!.poseClips.push('rabbit.collision');
    m3Capabilities.entityCapabilities.find(entity => entity.entityType === 'rabbit')!.actions.push({
      action: 'collision', requiredPoseClips: ['rabbit.collision'], poseBindings: [{direction: 'left', poseClipId: 'rabbit.collision'}],
      targetTypes: ['stump'], minDurationFrames: 18, supportsDirections: ['left'], defaultDirection: 'left',
      completionPolicy: 'hold', spatialMode: 'stationary',
      interaction: {
        contact: {targetAnchorId: 'impact', actorGroundOffset: {u: -0.04, v: 0.01}},
        effect: {effectType: 'impact-burst', trigger: 'action-start', durationFrames: 10},
      },
    });
    m3Capabilities.entityCapabilities.find(entity => entity.entityType === 'rabbit')!.poseClips.push('rabbit.sparkle');
    m3Capabilities.entityCapabilities.find(entity => entity.entityType === 'rabbit')!.actions.push({
      action: 'sparkle', requiredPoseClips: ['rabbit.sparkle'], poseBindings: [{direction: 'left', poseClipId: 'rabbit.sparkle'}],
      targetTypes: ['stump'], minDurationFrames: 10, supportsDirections: ['left'], defaultDirection: 'left',
      completionPolicy: 'hold', spatialMode: 'stationary',
      interaction: {effect: {effectType: 'optional-magic-spark', trigger: 'action-start', durationFrames: 10}},
    });
    const farmerCapability = m3Capabilities.entityCapabilities.find(entity => entity.entityType === 'farmer')!;
    farmerCapability.poseClips.push('farmer.pickup-rabbit');
    farmerCapability.attachmentSlots.push('baked-rabbit');
    farmerCapability.actions.push({
      action: 'pickup', requiredPoseClips: ['farmer.pickup-rabbit'], poseBindings: [{direction: 'right', poseClipId: 'farmer.pickup-rabbit'}],
      targetTypes: ['rabbit'], minDurationFrames: 30, supportsDirections: ['right'], defaultDirection: 'right',
      completionPolicy: 'hold', spatialMode: 'stationary', attachmentMode: 'baked',
      interaction: {ownership: {mode: 'baked', timing: 'action-start', ownerSlot: 'baked-rabbit', compositeSlotId: 'rabbit'}},
    });
    m3Capabilities.environmentCapabilities[0]!.allowedEntityTypes.push('stump');

    const effectiveDirectorPlan = await createEffectiveDirectorPlan({story: sourceStory, directorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan, capabilityCatalog: m3Capabilities});
    const measuredAudio: MeasuredAudio[] = preflight.ttsRequests.map(request => ({
      requestId: request.id, sourceTtsRequestHash: request.inputHash, assetId: `audio.${request.id}`,
      sampleRate: 48_000, sampleFrameCount: 24_000, channels: 1, contentHash: HASH,
      measurementProducer: {name: 'm3-visual-test', version: '1.0.0'},
    }));
    const collisionClip = poseClip('rabbit.collision', 'rabbit', 'collision', 'left');
    const pickupClip = {...poseClip('farmer.pickup-rabbit', 'farmer', 'pickup', 'right'), compositeSlots: [{id: 'rabbit', entityType: 'rabbit'}]};
    const stumpClip = poseClip('stump.idle', 'stump', 'idle', 'right');
    const impactClip = poseClip('impact-burst.idle', 'impact-burst', 'impact', 'right');
    const baseAssets = base.assetCatalog.assets.assets.filter(asset => asset.kind !== 'audio');
    const environment = structuredClone(base.assetCatalog.environments[0]!);
    environment.layers[0]!.transform = {position: {x: -320, y: -180}, scale: {x: 1.5, y: 1.5}, rotation: 0, opacity: 1};
    Object.assign(environment, {
      cameraSafeBounds: {minX: 440, maxX: 900, minY: 340, maxY: 380},
      coverageContract: {overscanScale: 1.5, minimumPixelCoverage: 0.995},
    });
    const assetCatalogPayload = {
      schemaVersion: '1.0.0' as const, mode: 'experiment' as const, productionReady: false,
      assets: {schemaVersion: '1.0.0' as const, assets: [
        ...baseAssets,
        visualAsset('rabbit.collision.frame', 'animal-frame'),
        visualAsset('farmer.pickup-rabbit.frame', 'character-frame'),
        {...visualAsset('stump.idle.frame', 'character-frame'), kind: 'prop' as const},
        {...visualAsset('impact-burst.idle.frame', 'character-frame'), kind: 'prop' as const},
        ...measuredAudio.map(audio => ({id: audio.assetId, kind: 'audio' as const, uri: `${audio.assetId}.wav`, contentHash: audio.contentHash, source: 'manual' as const, qaStatus: 'passed' as const})),
      ]},
      poseClips: [...base.assetCatalog.poseClips, collisionClip, pickupClip, stumpClip, impactClip],
      environments: [environment],
      entityDefinitions: [
        {...base.assetCatalog.entityDefinitions.find(definition => definition.entityType === 'rabbit')!, poseClipIds: ['rabbit.idle-left', 'rabbit.run-left', 'rabbit.collision']},
        {...base.assetCatalog.entityDefinitions.find(definition => definition.entityType === 'farmer')!, poseClipIds: ['farmer.idle-right', 'farmer.notice-right', 'farmer.pickup-rabbit'], attachmentSlots: [{id: 'baked-rabbit', ownerAnchor: 'center'}]},
        {id: 'stump-definition', entityType: 'stump', displayName: 'Stump', poseClipIds: ['stump.idle'], defaultPoseClipId: 'stump.idle', attachmentSlots: [], interactionAnchors: [{id: 'impact', groundOffset: {u: -0.02, v: 0}}]},
        {id: 'impact-definition', entityType: 'impact-burst', displayName: 'Impact', poseClipIds: ['impact-burst.idle'], defaultPoseClipId: 'impact-burst.idle', attachmentSlots: []},
      ],
      characterBindings: base.assetCatalog.characterBindings,
      landmarkBindings: [{landmarkType: 'stump', entityDefinitionId: 'stump-definition'}],
      effectBindings: [{effectType: 'impact-burst', entityDefinitionId: 'impact-definition'}],
    };
    const assetCatalog = {...assetCatalogPayload, catalogHash: await hashResolvedAssetCatalogPayload(assetCatalogPayload)};
    const plan = await compileFinal({
      effectiveDirectorPlan, preflight, measuredAudio, capabilityCatalog: m3Capabilities, assetCatalog,
      context: {seed: 43, compilerVersion: '0.2.0', compiledAt: '2026-08-13T00:00:00.000Z'},
    });

    expect(plan.instances.map(instance => instance.id)).toEqual(['farmer', 'rabbit', 'stump', 'effect.expanded.action-collision']);
    expect(plan.timeline.ownershipEvents).toEqual([expect.objectContaining({
      entityId: 'rabbit', mode: 'baked', to: {kind: 'entity', entityId: 'farmer', slot: 'baked-rabbit'},
    })]);
    expect(plan.timeline.effectEvents).toEqual([expect.objectContaining({effectType: 'impact-burst', targetEntityId: 'stump'})]);
    expect(plan.timeline.visibilityEvents.map(event => event.visible)).toEqual([true, false]);
    expect(plan.instances.some(instance => instance.id.includes('action-sparkle'))).toBe(false);
    expect(plan.provenance.warnings).toContainEqual(expect.objectContaining({code: 'OPTIONAL_ACTION_DROPPED'}));
    expect(plan.timeline.entityTracks.find(track => track.entityId === 'rabbit')?.groundPosition?.[0]?.value.u).toBeCloseTo(0.66, 8);
    expect(plan.timeline.cameraTracks.flatMap(track => track.position).every(keyframe =>
      keyframe.value.x >= 440 && keyframe.value.x <= 900 && keyframe.value.y >= 340 && keyframe.value.y <= 380)).toBe(true);
    expect(plan.provenance.compilerVersion).toBe('0.2.0');
    expect(assertRenderPlanIntegrity(plan)).toEqual(plan);
    expect(prepareRenderPlan(plan).plan).toEqual(plan);

    const collidingEntityId = 'effect.expanded.action-collision';
    const collidingDirectorPlan = DirectorPlanSchema.parse({
      ...directorPlan,
      characters: [...directorPlan.characters, {
        characterId: collidingEntityId,
        entityType: 'farmer',
        role: 'collision-id-sentinel',
        initialBlocking: {horizontal: 'far-left', depth: 'ground'},
      }],
    });
    const collidingSourceDirectorPlanHash = await canonicalHash('director-plan-v1', collidingDirectorPlan);
    const collidingEffectiveDirectorPlan = {
      sourceDirectorPlanHash: collidingSourceDirectorPlanHash,
      overrideIds: [],
      plan: collidingDirectorPlan,
      effectivePlanHash: await canonicalHash('effective-director-plan-v1', {
        sourceDirectorPlanHash: collidingSourceDirectorPlanHash,
        overrideIds: [],
        plan: collidingDirectorPlan,
      }),
    };
    const collidingPreflight = await compilePreflight({
      effectiveDirectorPlan: collidingEffectiveDirectorPlan,
      capabilityCatalog: m3Capabilities,
    });
    const collidingCatalogPayload = {
      ...assetCatalogPayload,
      characterBindings: [...assetCatalogPayload.characterBindings, {
        characterId: collidingEntityId,
        entityDefinitionId: 'farmer-definition',
      }],
    };
    const collidingCatalog = {
      ...collidingCatalogPayload,
      catalogHash: await hashResolvedAssetCatalogPayload(collidingCatalogPayload),
    };
    await expect(compileFinal({
      effectiveDirectorPlan: collidingEffectiveDirectorPlan,
      preflight: collidingPreflight,
      measuredAudio,
      capabilityCatalog: m3Capabilities,
      assetCatalog: collidingCatalog,
      context: {seed: 43, compilerVersion: '0.2.0', compiledAt: '2026-08-13T00:00:00.000Z'},
    })).rejects.toThrow(/Duplicate EntityTrack for effect\.expanded\.action-collision/);
  });
});
