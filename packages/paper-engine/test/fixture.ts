import {RenderPlanSchema} from '@pose-clip/schemas';

export const demoRenderPlan = RenderPlanSchema.parse({
  schemaVersion: '1.0.0',
  project: {
    id: 'story-demo', title: '守株待兔', fps: 30,
    resolution: {width: 1280, height: 720}, sampleRate: 48_000,
    seed: 1, styleGuideId: 'paper-style', capabilityCatalogVersion: '1.0.0',
  },
  assets: {
    schemaVersion: '1.0.0',
    assets: [
      {id: 'farm-far', kind: 'environment-layer', uri: 'farm-far.png', contentHash: 'farm-far-hash', source: 'manual', qaStatus: 'passed', width: 1280, height: 720, alphaMode: 'opaque'},
      {id: 'farmer-idle-frame', kind: 'character-frame', uri: 'farmer.png', contentHash: 'farmer-frame-hash', source: 'manual', qaStatus: 'passed', width: 100, height: 200, alphaMode: 'straight'},
    ],
  },
  environments: [{
    id: 'farm', name: 'Farm', referenceResolution: {width: 1280, height: 720},
    layers: [{
      id: 'far', assetId: 'farm-far', renderLayer: 'far', zIndex: 0, parallaxFactor: 0.1,
      transform: {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1},
    }],
    ground: {
      farLeft: {x: 0.1, y: 0.5}, farRight: {x: 0.9, y: 0.5},
      nearLeft: {x: 0, y: 1}, nearRight: {x: 1, y: 1},
      farScale: 0.5, nearScale: 1, depthEasing: 'linear', walkableZones: [],
    },
    occlusionZones: [],
  }],
  entities: [{
    id: 'farmer-def', entityType: 'farmer', displayName: 'Farmer',
    poseClipIds: ['farmer.idle'], defaultPoseClipId: 'farmer.idle', attachmentSlots: [],
  }],
  instances: [{
    id: 'farmer', definitionId: 'farmer-def', sceneId: 'scene-1',
    activeRange: {startFrame: 0, endFrame: 91},
    initialOwner: {kind: 'world', environmentId: 'farm'},
  }],
  poseClips: [{
    id: 'farmer.idle', entityType: 'farmer', action: 'idle', loop: true, direction: 'right',
    frames: [{
      assetId: 'farmer-idle-frame', durationFrames: 30,
      anchors: {foot: {x: 0.5, y: 0.95}, center: {x: 0.5, y: 0.5}},
      contact: {type: 'both'},
    }],
    rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 3},
  }],
  timeline: {
    schemaVersion: '1.0.0', fps: 30, durationFrames: 91,
    shots: [{id: 'shot-01', sceneId: 'scene-1', environmentId: 'farm', range: {startFrame: 0, endFrame: 91}, focusEntityId: 'farmer'}],
    entityTracks: [{
      entityId: 'farmer',
      groundPosition: [{frame: 0, value: {u: 0.25, v: 0.5}, easing: 'hold'}],
    }],
    cameraTracks: [{
      shotId: 'shot-01',
      position: [{frame: 0, value: {x: 0, y: 0}, easing: 'hold'}],
      zoom: [{frame: 0, value: 1, easing: 'hold'}],
    }],
    poseEvents: [], poseTransitions: [], ownershipEvents: [], visibilityEvents: [], effectEvents: [],
    narration: [],
    subtitles: [{id: 'subtitle-1', range: {startFrame: 30, endFrame: 61}, text: '农夫正在田里劳作。', styleId: 'default'}],
    sfx: [], transitions: [], markers: [],
  },
  provenance: {
    compilerVersion: '1.0.0', sourceDirectorPlanHash: 'source-plan-hash',
    effectiveDirectorPlanHash: 'effective-plan-hash', directorOverrideIds: [],
    capabilityCatalogVersion: '1.0.0', compiledAt: '2026-08-11T00:00:00.000Z', warnings: [],
  },
});
