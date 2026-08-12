import {RenderPlanSchema, type PoseAnchors, type RenderPlan} from '@pose-clip/schemas';
import farmerIdle from '../anchors/farmer/idle.json' with {type: 'json'};
import farmerNoticeRight from '../anchors/farmer/notice-right.json' with {type: 'json'};
import rabbitCollision from '../anchors/rabbit/collision.json' with {type: 'json'};
import rabbitLying from '../anchors/rabbit/lying.json' with {type: 'json'};
import rabbitRun01 from '../anchors/rabbit/run-left-01.json' with {type: 'json'};
import rabbitRun02 from '../anchors/rabbit/run-left-02.json' with {type: 'json'};
import rabbitRun03 from '../anchors/rabbit/run-left-03.json' with {type: 'json'};
import rabbitRun04 from '../anchors/rabbit/run-left-04.json' with {type: 'json'};
import {importedPackageDecision, importedVisualAsset} from './asset-package-importer.js';

const HASH = importedPackageDecision.packageHash;
const transform = {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1};

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
        importedVisualAsset('env-far', 'environment-layer', 'processed/environment/far.png', 'opaque'),
        importedVisualAsset('env-mid', 'environment-layer', 'processed/environment/mid.png'),
        importedVisualAsset('env-ground', 'environment-layer', 'processed/environment/ground.png'),
        importedVisualAsset('env-foreground', 'environment-layer', 'processed/environment/foreground.png'),
        importedVisualAsset('farmer-idle', 'character-frame', 'normalized/farmer/idle.png'),
        importedVisualAsset('farmer-notice-right', 'character-frame', 'normalized/farmer/notice-right.png'),
        importedVisualAsset('rabbit-run-01', 'animal-frame', 'normalized/rabbit/run-left-01.png'),
        importedVisualAsset('rabbit-run-02', 'animal-frame', 'normalized/rabbit/run-left-02.png'),
        importedVisualAsset('rabbit-run-03', 'animal-frame', 'normalized/rabbit/run-left-03.png'),
        importedVisualAsset('rabbit-run-04', 'animal-frame', 'normalized/rabbit/run-left-04.png'),
        importedVisualAsset('rabbit-collision', 'animal-frame', 'normalized/rabbit/collision.png'),
        importedVisualAsset('rabbit-lying', 'animal-frame', 'normalized/rabbit/lying.png'),
        importedVisualAsset('soft-shadow', 'prop', 'processed/shadow.png'),
        importedVisualAsset('impact-burst', 'prop', 'processed/effects/impact.png'),
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
      {id: 'farmer-def', entityType: 'farmer', displayName: 'Farmer', poseClipIds: ['farmer.idle', 'farmer.notice-right'], defaultPoseClipId: 'farmer.idle', attachmentSlots: []},
      {id: 'rabbit-def', entityType: 'rabbit', displayName: 'Rabbit', poseClipIds: ['rabbit.run-left', 'rabbit.collision', 'rabbit.lying'], defaultPoseClipId: 'rabbit.run-left', attachmentSlots: []},
      {id: 'shadow-def', entityType: 'shadow', displayName: 'Rabbit shadow', poseClipIds: ['shadow.idle'], defaultPoseClipId: 'shadow.idle', attachmentSlots: []},
      // The impact remains an ordinary entity; the nearer entity depth makes it render
      // after the rabbit while the foreground environment layer can still occlude both.
      {id: 'impact-def', entityType: 'effect', displayName: 'Paper impact', poseClipIds: ['impact.idle'], defaultPoseClipId: 'impact.idle', attachmentSlots: []},
    ],
    instances: [
      {id: 'farmer', definitionId: 'farmer-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
      {id: 'rabbit', definitionId: 'rabbit-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
      {id: 'rabbit-shadow', definitionId: 'shadow-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
      {id: 'impact', definitionId: 'impact-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 300}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
    ],
    poseClips: [
      {
        id: 'farmer.idle', entityType: 'farmer', action: 'idle', loop: true, direction: 'front',
        frames: [{assetId: 'farmer-idle', durationFrames: 30, anchors: anchors(farmerIdle), contact: {type: 'both'}, referenceFoot: 'midpoint'}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 8},
      },
      {
        id: 'farmer.notice-right', entityType: 'farmer', action: 'notice', loop: true, direction: 'right',
        frames: [{assetId: 'farmer-notice-right', durationFrames: 30, anchors: anchors(farmerNoticeRight), contact: {type: 'both'}, referenceFoot: 'midpoint'}],
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
      {
        id: 'impact.idle', entityType: 'effect', action: 'impact', loop: true, direction: 'front',
        frames: [{assetId: 'impact-burst', durationFrames: 30, anchors: {foot: {x: 0.5, y: 0.5}, center: {x: 0.5, y: 0.5}}, contact: {type: 'none'}}],
        rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0},
      },
    ],
    timeline: {
      schemaVersion: '1.0.0', fps: 30, durationFrames: 300,
      shots: [{id: 'shot-01', sceneId: 'scene-1', environmentId: 'pastoral-field', range: {startFrame: 0, endFrame: 300}, focusEntityId: 'rabbit'}],
      entityTracks: [
        {
          entityId: 'farmer',
          groundPosition: [{frame: 0, value: {u: 0.21, v: 0.58}, easing: 'linear'}, {frame: 165, value: {u: 0.21, v: 0.58}, easing: 'linear'}, {frame: 240, value: {u: 0.31, v: 0.69}, easing: 'ease-out'}, {frame: 299, value: {u: 0.31, v: 0.69}, easing: 'hold'}],
          scale: [{frame: 0, value: {x: 0.205, y: 0.205}, easing: 'linear'}, {frame: 14, value: {x: 0.208, y: 0.208}, easing: 'linear'}, {frame: 29, value: {x: 0.205, y: 0.205}, easing: 'linear'}, {frame: 165, value: {x: 0.205, y: 0.205}, easing: 'linear'}, {frame: 206, value: {x: 0.205, y: 0.205}, easing: 'ease-in'}, {frame: 209, value: {x: 0.211, y: 0.211}, easing: 'linear'}, {frame: 210, value: {x: 0.205, y: 0.205}, easing: 'linear'}, {frame: 240, value: {x: 0.23, y: 0.23}, easing: 'hold'}],
          rotation: [{frame: 0, value: -0.0052, easing: 'linear'}, {frame: 15, value: 0.0052, easing: 'linear'}, {frame: 30, value: -0.0052, easing: 'linear'}, {frame: 165, value: -0.0052, easing: 'linear'}, {frame: 180, value: 0.0052, easing: 'linear'}, {frame: 195, value: -0.0052, easing: 'linear'}, {frame: 206, value: -0.0052, easing: 'ease-in'}, {frame: 209, value: 0.012, easing: 'linear'}, {frame: 210, value: 0, easing: 'hold'}],
        },
        {entityId: 'rabbit', groundPosition: [{frame: 0, value: {u: 0.82, v: 0.60}, easing: 'linear'}, {frame: 89, value: {u: 0.73, v: 0.61}, easing: 'linear'}, {frame: 299, value: {u: 0.73, v: 0.61}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.18, y: 0.18}, easing: 'hold'}]},
        {entityId: 'rabbit-shadow', groundPosition: [{frame: 0, value: {u: 0.82, v: 0.60}, easing: 'linear'}, {frame: 89, value: {u: 0.73, v: 0.61}, easing: 'linear'}, {frame: 299, value: {u: 0.73, v: 0.61}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.34, y: 0.34}, easing: 'hold'}], opacity: [{frame: 0, value: 0.4, easing: 'hold'}]},
        {entityId: 'impact', groundPosition: [{frame: 0, value: {u: 0.755, v: 0.68}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.22, y: 0.22}, easing: 'linear'}, {frame: 90, value: {x: 0.22, y: 0.22}, easing: 'linear'}, {frame: 97, value: {x: 0.32, y: 0.32}, easing: 'hold'}]},
      ],
      cameraTracks: [{shotId: 'shot-01', position: [{frame: 0, value: {x: 670, y: 360}, easing: 'hold'}, {frame: 165, value: {x: 670, y: 360}, easing: 'ease-in-out'}, {frame: 225, value: {x: 610, y: 360}, easing: 'hold'}, {frame: 299, value: {x: 610, y: 360}, easing: 'hold'}], zoom: [{frame: 0, value: 1, easing: 'hold'}]}],
      poseEvents: [
        {id: 'rabbit-collision-event', frame: 90, entityId: 'rabbit', poseClipId: 'rabbit.collision', clipStartOffset: 0, playbackRate: 1},
        {id: 'rabbit-lying-event', frame: 150, entityId: 'rabbit', poseClipId: 'rabbit.lying', clipStartOffset: 0, playbackRate: 1},
        {id: 'farmer-notice-right-event', frame: 210, entityId: 'farmer', poseClipId: 'farmer.notice-right', clipStartOffset: 0, playbackRate: 1},
      ],
      poseTransitions: [
        {id: 'rabbit-run-collision-xfade', entityId: 'rabbit', fromPoseClipId: 'rabbit.run-left', toPoseClipId: 'rabbit.collision', startFrame: 90, durationFrames: 3, mode: 'crossfade', anchorPolicy: 'foot'},
        {id: 'rabbit-collision-lying-xfade', entityId: 'rabbit', fromPoseClipId: 'rabbit.collision', toPoseClipId: 'rabbit.lying', startFrame: 150, durationFrames: 3, mode: 'crossfade', anchorPolicy: 'foot'},
        {id: 'farmer-idle-notice-cut', entityId: 'farmer', fromPoseClipId: 'farmer.idle', toPoseClipId: 'farmer.notice-right', startFrame: 210, durationFrames: 0, mode: 'cut', anchorPolicy: 'foot'},
      ], ownershipEvents: [],
      visibilityEvents: [
        {id: 'shadow-hidden', frame: 150, entityId: 'rabbit-shadow', visible: false},
        {id: 'impact-hidden-start', frame: 0, entityId: 'impact', visible: false},
        {id: 'impact-visible', frame: 90, entityId: 'impact', visible: true},
        {id: 'impact-hidden-end', frame: 98, entityId: 'impact', visible: false},
      ],
      effectEvents: [],
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
