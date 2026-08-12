import {RenderPlanSchema, type PoseAnchors, type RenderPlan} from '@pose-clip/schemas';
import farmerIdle from '../anchors/idle.json' with {type: 'json'};
import farmerReaction from '../anchors/reaction.json' with {type: 'json'};
import rabbitCollision from '../anchors/collision.json' with {type: 'json'};
import rabbitLying from '../anchors/lying.json' with {type: 'json'};
import rabbitRun01 from '../anchors/run-left-01.json' with {type: 'json'};
import rabbitRun02 from '../anchors/run-left-02.json' with {type: 'json'};
import rabbitRun03 from '../anchors/run-left-03.json' with {type: 'json'};
import rabbitRun04 from '../anchors/run-left-04.json' with {type: 'json'};

const HASH = '0'.repeat(64);
const transform = {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1};

function uri(file: string): string {
  return new URL(`/processed/${file}`, location.href).href;
}

function provenance() {
  return {
    inputHash: HASH,
    promptHash: HASH,
    modelId: 'imagegen',
    modelVersion: '2026-08-12',
    workflowVersion: '1.0.0',
    producer: {name: 'asset-feasibility', version: '0.1.0'},
    createdAt: '2026-08-12T00:00:00.000Z',
  };
}

function visual(id: string, kind: 'environment-layer' | 'character-frame' | 'animal-frame' | 'prop', file: string, width: number, height: number, alphaMode: 'straight' | 'opaque' = 'straight') {
  return {id, kind, uri: uri(file), contentHash: HASH, source: 'generated' as const, provenance: provenance(), qaStatus: 'passed' as const, width, height, alphaMode};
}

function anchors(value: {anchors: Record<string, {x: number; y: number}>}): PoseAnchors {
  return value.anchors as unknown as PoseAnchors;
}

export function createAssetGateRenderPlan(): RenderPlan {
  return RenderPlanSchema.parse({
    schemaVersion: '1.0.0',
    project: {
      id: 'asset-gate-rabbit-tree', title: '守株待兔 · AI Asset Gate', fps: 30,
      resolution: {width: 1280, height: 720}, sampleRate: 48_000,
      seed: 20260812, styleGuideId: 'warm-paper-cut', capabilityCatalogVersion: '1.0.0',
    },
    assets: {
      schemaVersion: '1.0.0',
      assets: [
        visual('env-far', 'environment-layer', 'environment/far.png', 1280, 720, 'opaque'),
        visual('env-mid', 'environment-layer', 'environment/mid.png', 1280, 720),
        visual('env-ground', 'environment-layer', 'environment/ground.png', 1280, 720),
        visual('env-foreground', 'environment-layer', 'environment/foreground.png', 1280, 720),
        visual('farmer-idle', 'character-frame', 'farmer/idle.png', 1024, 1536),
        visual('farmer-reaction', 'character-frame', 'farmer/reaction.png', 1024, 1536),
        visual('rabbit-run-01', 'animal-frame', 'rabbit/run-left-01.png', 1402, 1122),
        visual('rabbit-run-02', 'animal-frame', 'rabbit/run-left-02.png', 1402, 1122),
        visual('rabbit-run-03', 'animal-frame', 'rabbit/run-left-03.png', 1402, 1122),
        visual('rabbit-run-04', 'animal-frame', 'rabbit/run-left-04.png', 1402, 1122),
        visual('rabbit-collision', 'animal-frame', 'rabbit/collision.png', 1402, 1122),
        visual('rabbit-lying', 'animal-frame', 'rabbit/lying.png', 1402, 1122),
        visual('soft-shadow', 'prop', 'shadow.png', 512, 192),
      ],
    },
    environments: [{
      id: 'pastoral-field', name: 'Pastoral field', referenceResolution: {width: 1280, height: 720},
      layers: [
        {id: 'far', assetId: 'env-far', renderLayer: 'far', zIndex: 0, parallaxFactor: 0.1, transform},
        {id: 'mid', assetId: 'env-mid', renderLayer: 'mid', zIndex: 0, parallaxFactor: 0.35, transform},
        {id: 'ground', assetId: 'env-ground', renderLayer: 'ground', zIndex: 0, parallaxFactor: 0.7, transform},
        {id: 'foreground', assetId: 'env-foreground', renderLayer: 'foreground', zIndex: 0, parallaxFactor: 1.15, transform},
      ],
      ground: {
        farLeft: {x: 0.05, y: 0.58}, farRight: {x: 0.95, y: 0.58},
        nearLeft: {x: 0, y: 0.96}, nearRight: {x: 1, y: 0.96},
        farScale: 0.55, nearScale: 1, depthEasing: 'linear', walkableZones: [],
      },
      occlusionZones: [],
    }],
    entities: [
      {id: 'farmer-def', entityType: 'farmer', displayName: 'Farmer', poseClipIds: ['farmer.idle', 'farmer.reaction'], defaultPoseClipId: 'farmer.idle', attachmentSlots: []},
      {id: 'rabbit-def', entityType: 'rabbit', displayName: 'Rabbit', poseClipIds: ['rabbit.run-left', 'rabbit.collision', 'rabbit.lying'], defaultPoseClipId: 'rabbit.run-left', attachmentSlots: []},
      {id: 'shadow-def', entityType: 'shadow', displayName: 'Rabbit shadow', poseClipIds: ['shadow.idle'], defaultPoseClipId: 'shadow.idle', attachmentSlots: []},
    ],
    instances: [
      {id: 'farmer', definitionId: 'farmer-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
      {id: 'rabbit', definitionId: 'rabbit-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
      {id: 'rabbit-shadow', definitionId: 'shadow-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
    ],
    poseClips: [
      {
        id: 'farmer.idle', entityType: 'farmer', action: 'idle', loop: true, direction: 'front',
        frames: [{assetId: 'farmer-idle', durationFrames: 30, anchors: anchors(farmerIdle), contact: {type: 'both'}, referenceFoot: 'midpoint'}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 8},
      },
      {
        id: 'farmer.reaction', entityType: 'farmer', action: 'reaction', loop: true, direction: 'front',
        frames: [{assetId: 'farmer-reaction', durationFrames: 30, anchors: anchors(farmerReaction), contact: {type: 'both'}, referenceFoot: 'midpoint'}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 8},
      },
      {
        id: 'rabbit.run-left', entityType: 'rabbit', action: 'run', loop: true, direction: 'left',
        frames: [
          {assetId: 'rabbit-run-01', durationFrames: 3, anchors: anchors(rabbitRun01), contact: {type: 'left-foot'}, referenceFoot: 'left-foot'},
          {assetId: 'rabbit-run-02', durationFrames: 3, anchors: anchors(rabbitRun02), contact: {type: 'right-foot'}, referenceFoot: 'right-foot'},
          {assetId: 'rabbit-run-03', durationFrames: 3, anchors: anchors(rabbitRun03), contact: {type: 'left-foot'}, referenceFoot: 'left-foot'},
          {assetId: 'rabbit-run-04', durationFrames: 3, anchors: anchors(rabbitRun04), contact: {type: 'right-foot'}, referenceFoot: 'right-foot'},
        ],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'contact-only', maxCorrectionPx: 48},
      },
      {
        id: 'rabbit.collision', entityType: 'rabbit', action: 'collision', loop: true, direction: 'left',
        frames: [{assetId: 'rabbit-collision', durationFrames: 30, anchors: anchors(rabbitCollision), contact: {type: 'both'}, referenceFoot: 'midpoint'}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 8},
      },
      {
        id: 'rabbit.lying', entityType: 'rabbit', action: 'lying', loop: true, direction: 'left',
        frames: [{assetId: 'rabbit-lying', durationFrames: 30, anchors: anchors(rabbitLying), contact: {type: 'both'}, referenceFoot: 'midpoint'}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 8},
      },
      {
        id: 'shadow.idle', entityType: 'shadow', action: 'idle', loop: true, direction: 'front',
        frames: [{assetId: 'soft-shadow', durationFrames: 30, anchors: {foot: {x: 0.5, y: 0.5}, center: {x: 0.5, y: 0.5}}, contact: {type: 'none'}}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0},
      },
    ],
    timeline: {
      schemaVersion: '1.0.0', fps: 30, durationFrames: 300,
      shots: [{id: 'shot-01', sceneId: 'scene-1', environmentId: 'pastoral-field', range: {startFrame: 0, endFrame: 300}, focusEntityId: 'rabbit'}],
      entityTracks: [
        {entityId: 'farmer', groundPosition: [{frame: 0, value: {u: 0.28, v: 0.72}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.24, y: 0.24}, easing: 'hold'}]},
        {entityId: 'rabbit', groundPosition: [{frame: 0, value: {u: 0.96, v: 0.76}, easing: 'linear'}, {frame: 89, value: {u: 0.73, v: 0.76}, easing: 'linear'}, {frame: 299, value: {u: 0.73, v: 0.76}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.18, y: 0.18}, easing: 'hold'}]},
        {entityId: 'rabbit-shadow', groundPosition: [{frame: 0, value: {u: 0.96, v: 0.76}, easing: 'linear'}, {frame: 89, value: {u: 0.73, v: 0.76}, easing: 'linear'}, {frame: 299, value: {u: 0.73, v: 0.76}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.34, y: 0.34}, easing: 'hold'}], opacity: [{frame: 0, value: 0.45, easing: 'hold'}]},
      ],
      cameraTracks: [{shotId: 'shot-01', position: [{frame: 0, value: {x: 640, y: 360}, easing: 'linear'}, {frame: 299, value: {x: 670, y: 360}, easing: 'linear'}], zoom: [{frame: 0, value: 1, easing: 'hold'}]}],
      poseEvents: [
        {id: 'rabbit-collision-event', frame: 90, entityId: 'rabbit', poseClipId: 'rabbit.collision', clipStartOffset: 0, playbackRate: 1},
        {id: 'rabbit-lying-event', frame: 150, entityId: 'rabbit', poseClipId: 'rabbit.lying', clipStartOffset: 0, playbackRate: 1},
        {id: 'farmer-reaction-event', frame: 210, entityId: 'farmer', poseClipId: 'farmer.reaction', clipStartOffset: 0, playbackRate: 1},
      ],
      poseTransitions: [
        {id: 'rabbit-run-collision-xfade', entityId: 'rabbit', fromPoseClipId: 'rabbit.run-left', toPoseClipId: 'rabbit.collision', startFrame: 90, durationFrames: 3, mode: 'crossfade', anchorPolicy: 'foot'},
        {id: 'rabbit-collision-lying-xfade', entityId: 'rabbit', fromPoseClipId: 'rabbit.collision', toPoseClipId: 'rabbit.lying', startFrame: 150, durationFrames: 3, mode: 'crossfade', anchorPolicy: 'foot'},
        {id: 'farmer-idle-reaction-xfade', entityId: 'farmer', fromPoseClipId: 'farmer.idle', toPoseClipId: 'farmer.reaction', startFrame: 210, durationFrames: 3, mode: 'crossfade', anchorPolicy: 'foot'},
      ], ownershipEvents: [],
      visibilityEvents: [
        {id: 'farmer-hidden', frame: 0, entityId: 'farmer', visible: false},
        {id: 'farmer-revealed', frame: 180, entityId: 'farmer', visible: true},
        {id: 'shadow-hidden', frame: 150, entityId: 'rabbit-shadow', visible: false},
      ],
      effectEvents: [{id: 'collision-pop', frame: 90, effectType: 'paper-impact', targetEntityId: 'rabbit', durationFrames: 8}],
      narration: [], subtitles: [
        {id: 'subtitle-run', range: {startFrame: 0, endFrame: 90}, text: '一只兔子飞快地奔向田边……', styleId: 'default'},
        {id: 'subtitle-hit', range: {startFrame: 90, endFrame: 150}, text: '砰！它撞在老树旁。', styleId: 'default'},
        {id: 'subtitle-down', range: {startFrame: 150, endFrame: 210}, text: '兔子倒在地上，一动不动。', styleId: 'default'},
        {id: 'subtitle-find', range: {startFrame: 210, endFrame: 300}, text: '农夫转身，发现了倒下的兔子。', styleId: 'default'},
      ],
      sfx: [], transitions: [], markers: [{id: 'collision-marker', frame: 90, type: 'collision', entityIds: ['rabbit']}],
    },
    provenance: {
      compilerVersion: '1.0.0', sourceDirectorPlanHash: HASH, effectiveDirectorPlanHash: HASH,
      directorOverrideIds: [], capabilityCatalogVersion: '1.0.0', compiledAt: '2026-08-12T00:00:00.000Z', warnings: [],
    },
  });
}
