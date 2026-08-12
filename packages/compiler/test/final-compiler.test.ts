import {describe, expect, it} from 'vitest';
import {
  DirectorPlanSchema,
  assertRenderPlanIntegrity,
  semanticRenderPlanHash,
  type FinalCompileInput,
  type MeasuredAudio,
} from '@pose-clip/schemas';
import {prepareRenderPlan} from '@pose-clip/paper-engine';
import {
  compileFinal,
  compilePreflight,
  createEffectiveDirectorPlan,
  hashResolvedAssetCatalogPayload,
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
    expect(plan.timeline.poseEvents.map(event => event.poseClipId)).toEqual(['rabbit.run-left', 'farmer.notice-right']);
    expect(plan.timeline.poseTransitions).toHaveLength(2);
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
});
