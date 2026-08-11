import {RenderPlanSchema} from '@pose-clip/schemas';

const HASH = '0'.repeat(64);
const transform = {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1};
const foot = {x: 0.5, y: 0.96};
const center = {x: 0.5, y: 0.5};

const visual = (id: string, kind: 'environment-layer' | 'character-frame' | 'animal-frame' | 'prop', width: number, height: number, extra = {}) => ({
  id, kind, uri: `${id}.png`, contentHash: HASH, source: 'manual', qaStatus: 'passed', width, height,
  alphaMode: kind === 'environment-layer' ? 'opaque' : 'straight', ...extra,
});

export const goldenFixtureV2 = RenderPlanSchema.parse({
  schemaVersion: '1.0.0',
  project: {
    id: 'golden-v2', title: 'Farmer and Rabbit', fps: 30,
    resolution: {width: 1280, height: 720}, sampleRate: 48_000,
    seed: 20260811, styleGuideId: 'paper-style', capabilityCatalogVersion: '1.0.0',
  },
  assets: {
    schemaVersion: '1.0.0',
    assets: [
      visual('farm-far', 'environment-layer', 1280, 720),
      visual('farm-mid', 'environment-layer', 1280, 720),
      visual('farm-ground', 'environment-layer', 1280, 720),
      visual('farm-foreground', 'environment-layer', 1280, 720),
      visual('farmer-walk-left', 'character-frame', 200, 400),
      visual('farmer-walk-right', 'character-frame', 200, 400),
      visual('farmer-hold-rabbit', 'character-frame', 240, 400),
      visual('rabbit-idle', 'animal-frame', 120, 100),
      visual('lantern-idle', 'prop', 60, 100, {attachmentAnchors: [{id: 'grip', point: {x: 0.5, y: 0.05}}]}),
      {id: 'narration', kind: 'audio', uri: 'narration.wav', contentHash: HASH, source: 'manual', qaStatus: 'passed'},
      {id: 'pickup-sfx', kind: 'audio', uri: 'pickup.wav', contentHash: HASH, source: 'manual', qaStatus: 'passed'},
    ],
  },
  environments: [{
    id: 'farm', name: 'Farm', referenceResolution: {width: 1280, height: 720},
    layers: [
      {id: 'far', assetId: 'farm-far', renderLayer: 'far', zIndex: 0, parallaxFactor: 0.1, transform},
      {id: 'mid', assetId: 'farm-mid', renderLayer: 'mid', zIndex: 0, parallaxFactor: 0.35, transform},
      {id: 'ground', assetId: 'farm-ground', renderLayer: 'ground', zIndex: 0, parallaxFactor: 0.7, transform},
      {id: 'foreground', assetId: 'farm-foreground', renderLayer: 'foreground', zIndex: 0, parallaxFactor: 1.15, transform},
    ],
    ground: {
      farLeft: {x: 0.1, y: 0.5}, farRight: {x: 0.9, y: 0.5},
      nearLeft: {x: 0, y: 1}, nearRight: {x: 1, y: 1},
      farScale: 0.5, nearScale: 1, depthEasing: 'linear', walkableZones: [],
    },
    occlusionZones: [],
  }],
  entities: [
    {
      id: 'farmer-def', entityType: 'farmer', displayName: 'Farmer',
      poseClipIds: ['farmer.walk', 'farmer.hold-rabbit'], defaultPoseClipId: 'farmer.walk',
      attachmentSlots: [{id: 'rightHand', ownerAnchor: 'rightHand'}, {id: 'arms', ownerAnchor: 'center'}],
    },
    {id: 'rabbit-def', entityType: 'rabbit', displayName: 'Rabbit', poseClipIds: ['rabbit.idle'], defaultPoseClipId: 'rabbit.idle', attachmentSlots: []},
    {id: 'lantern-def', entityType: 'lantern', displayName: 'Lantern', poseClipIds: ['lantern.idle'], defaultPoseClipId: 'lantern.idle', attachmentSlots: []},
  ],
  instances: [
    {id: 'farmer', definitionId: 'farmer-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 120}, initialOwner: {kind: 'world', environmentId: 'farm'}},
    {id: 'rabbit', definitionId: 'rabbit-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 120}, initialOwner: {kind: 'world', environmentId: 'farm'}},
    {id: 'lantern', definitionId: 'lantern-def', sceneId: 'scene-1', activeRange: {startFrame: 0, endFrame: 120}, initialOwner: {kind: 'world', environmentId: 'farm'}},
  ],
  poseClips: [
    {
      id: 'farmer.walk', entityType: 'farmer', action: 'walk', loop: true, direction: 'right',
      frames: [
        {assetId: 'farmer-walk-left', durationFrames: 4, anchors: {foot, leftFoot: {x: 0.4, y: 0.96}, rightFoot: {x: 0.6, y: 0.94}, center, rightHand: {x: 0.72, y: 0.42}}, contact: {type: 'left-foot'}, referenceFoot: 'auto'},
        {assetId: 'farmer-walk-right', durationFrames: 4, anchors: {foot, leftFoot: {x: 0.4, y: 0.94}, rightFoot: {x: 0.6, y: 0.96}, center, rightHand: {x: 0.73, y: 0.43}}, contact: {type: 'right-foot'}, referenceFoot: 'auto'},
      ],
      rootMotion: {mode: 'timeline'}, groundLock: {mode: 'contact-only', maxCorrectionPx: 30},
    },
    {
      id: 'farmer.hold-rabbit', entityType: 'farmer', action: 'hold', loop: true, direction: 'right',
      frames: [{assetId: 'farmer-hold-rabbit', durationFrames: 30, anchors: {foot, center, rightHand: {x: 0.7, y: 0.4}}, contact: {type: 'both'}}],
      rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 3},
      compositeSlots: [{id: 'carry-rabbit', entityType: 'rabbit'}],
    },
    {
      id: 'rabbit.idle', entityType: 'rabbit', action: 'idle', loop: true, direction: 'right',
      frames: [{assetId: 'rabbit-idle', durationFrames: 30, anchors: {foot: {x: 0.5, y: 0.95}, center}, contact: {type: 'both'}}],
      rootMotion: {mode: 'timeline'}, groundLock: {mode: 'always', maxCorrectionPx: 3},
    },
    {
      id: 'lantern.idle', entityType: 'lantern', action: 'idle', loop: true, direction: 'front',
      frames: [{assetId: 'lantern-idle', durationFrames: 30, anchors: {foot: {x: 0.5, y: 1}, center}, contact: {type: 'none'}}],
      rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0},
    },
  ],
  timeline: {
    schemaVersion: '1.0.0', fps: 30, durationFrames: 120,
    shots: [{id: 'shot-01', sceneId: 'scene-1', environmentId: 'farm', range: {startFrame: 0, endFrame: 120}, focusEntityId: 'farmer'}],
    entityTracks: [
      {entityId: 'farmer', groundPosition: [{frame: 0, value: {u: 0.25, v: 0.55}, easing: 'linear'}, {frame: 119, value: {u: 0.45, v: 0.55}, easing: 'linear'}], opacity: [{frame: 0, value: 0.8, easing: 'hold'}]},
      {entityId: 'rabbit', groundPosition: [{frame: 0, value: {u: 0.58, v: 0.56}, easing: 'hold'}]},
      {entityId: 'lantern', groundPosition: [{frame: 0, value: {u: 0.35, v: 0.54}, easing: 'hold'}]},
    ],
    cameraTracks: [{shotId: 'shot-01', position: [{frame: 0, value: {x: 640, y: 360}, easing: 'linear'}, {frame: 119, value: {x: 664, y: 360}, easing: 'linear'}], zoom: [{frame: 0, value: 1, easing: 'hold'}]}],
    poseEvents: [{id: 'farmer-hold', frame: 30, entityId: 'farmer', poseClipId: 'farmer.hold-rabbit', clipStartOffset: 0, playbackRate: 1}],
    poseTransitions: [{id: 'walk-to-hold', entityId: 'farmer', fromPoseClipId: 'farmer.walk', toPoseClipId: 'farmer.hold-rabbit', startFrame: 30, durationFrames: 3, mode: 'crossfade', anchorPolicy: 'foot'}],
    ownershipEvents: [
      {id: 'lantern-attach', frame: 20, type: 'attach', entityId: 'lantern', from: {kind: 'world', environmentId: 'farm'}, to: {kind: 'entity', entityId: 'farmer', slot: 'rightHand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: {attachmentAnchorId: 'grip', inheritRotation: true, inheritScale: true}},
      {id: 'rabbit-attach', frame: 50, type: 'attach', entityId: 'rabbit', from: {kind: 'world', environmentId: 'farm'}, to: {kind: 'entity', entityId: 'farmer', slot: 'arms'}, mode: 'baked', preserveWorldTransform: false, bakedBinding: {ownerEntityId: 'farmer', childEntityId: 'rabbit', compositeSlotId: 'carry-rabbit'}},
      {id: 'lantern-detach', frame: 80, type: 'detach', entityId: 'lantern', from: {kind: 'entity', entityId: 'farmer', slot: 'rightHand'}, to: {kind: 'world', environmentId: 'farm'}, mode: 'socket', preserveWorldTransform: false},
      {id: 'rabbit-detach', frame: 90, type: 'detach', entityId: 'rabbit', from: {kind: 'entity', entityId: 'farmer', slot: 'arms'}, to: {kind: 'world', environmentId: 'farm'}, mode: 'baked', preserveWorldTransform: false},
    ],
    visibilityEvents: [{id: 'lantern-hide', frame: 100, entityId: 'lantern', visible: false}],
    effectEvents: [{id: 'pickup-effect', frame: 50, effectType: 'paper-pop', durationFrames: 5}],
    narration: [{id: 'narration-1', range: {startFrame: 0, endFrame: 90}, assetId: 'narration', text: 'The farmer helps the rabbit.', sampleStart: 0, sampleLength: 144000}],
    subtitles: [{id: 'subtitle-1', range: {startFrame: 10, endFrame: 70}, text: 'The farmer helps the rabbit.', styleId: 'default'}],
    sfx: [{id: 'pickup-sfx-1', frame: 50, assetId: 'pickup-sfx', eventType: 'pickup', gainDb: -3}],
    transitions: [], markers: [{id: 'pickup-marker', frame: 50, type: 'ownership-transfer', entityIds: ['farmer', 'rabbit']}],
  },
  provenance: {
    compilerVersion: '1.0.0', sourceDirectorPlanHash: HASH,
    effectiveDirectorPlanHash: HASH, directorOverrideIds: [],
    capabilityCatalogVersion: '1.0.0', compiledAt: '2026-08-11T00:00:00.000Z', warnings: [],
  },
});

export const demoRenderPlan = goldenFixtureV2;
