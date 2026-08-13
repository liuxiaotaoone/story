import {describe, expect, it} from 'vitest';
import {
  ActionCapabilitySchema,
  DirectorPlanSchema,
  EnvironmentDefinitionSchema,
  ResolvedAssetCatalogSchema,
} from '../src/index.js';

const HASH = 'a'.repeat(64);
const transform = {position: {x: -320, y: -180}, scale: {x: 1.5, y: 1.5}, rotation: 0, opacity: 1};

describe('M3 visual productization contracts', () => {
  it('allows semantic landmarks, interaction targets and lead-room composition without Timeline fields', () => {
    const result = DirectorPlanSchema.parse({
      schemaVersion: '1.0.0', projectId: 'project', storyId: 'story', sourceStoryHash: HASH,
      storyBible: {title: 'Story', summary: 'Summary', styleGuideId: 'paper'},
      characters: [{characterId: 'rabbit', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'left', depth: 'ground'}}],
      scenes: [{id: 'scene', sourceBeatIds: ['beat'], environmentIntent: 'field', summary: 'Field'}],
      landmarks: [{id: 'stump', sceneId: 'scene', landmarkType: 'stump', blocking: {horizontal: 'right', depth: 'ground'}}],
      shots: [{id: 'shot', sceneId: 'scene', shotType: 'wide', focusEntityId: 'rabbit', composition: {subjectScreenX: 0.64, subjectScreenY: 0.72, leadRoom: 'left'}}],
      narration: [],
      actions: [{id: 'collision', sceneId: 'scene', shotId: 'shot', actorId: 'rabbit', targetId: 'stump', action: 'collision', sequence: 0, priority: 'required', enabled: true}],
      cameraIntents: [{id: 'camera', sceneId: 'scene', shotId: 'shot', type: 'follow', focusEntityId: 'rabbit'}],
      blockingIntents: [],
    });
    expect(result.landmarks?.[0]?.id).toBe('stump');
    expect(result.shots[0]?.composition?.leadRoom).toBe('left');
    expect(JSON.stringify(result)).not.toContain('startFrame');
  });

  it('rejects contradictory lead room and incomplete baked ownership capability', () => {
    const camera = {subjectScreenX: 0.3, subjectScreenY: 0.7, leadRoom: 'left'};
    expect(() => DirectorPlanSchema.parse({
      schemaVersion: '1.0.0', projectId: 'project', storyId: 'story', sourceStoryHash: HASH,
      storyBible: {title: 'Story', summary: 'Summary', styleGuideId: 'paper'},
      characters: [{characterId: 'rabbit', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'left', depth: 'ground'}}],
      scenes: [{id: 'scene', sourceBeatIds: ['beat'], environmentIntent: 'field', summary: 'Field'}],
      shots: [{id: 'shot', sceneId: 'scene', shotType: 'wide', composition: camera}], narration: [], actions: [],
      cameraIntents: [{id: 'camera', sceneId: 'scene', shotId: 'shot', type: 'static'}], blockingIntents: [],
    })).toThrow(/Left lead room/);
    expect(() => ActionCapabilitySchema.parse({
      action: 'pickup', requiredPoseClips: ['pickup'], poseBindings: [{direction: 'right', poseClipId: 'pickup'}],
      targetTypes: ['rabbit'], minDurationFrames: 10, supportsDirections: ['right'], defaultDirection: 'right',
      completionPolicy: 'hold', spatialMode: 'stationary',
      interaction: {ownership: {mode: 'baked', timing: 'action-start', ownerSlot: 'arms', compositeSlotId: 'rabbit'}},
    })).toThrow(/attachmentMode=baked/);
  });

  it('makes Shot.focusEntityId the single camera focus source', () => {
    const base = {
      schemaVersion: '1.0.0', projectId: 'project', storyId: 'story', sourceStoryHash: HASH,
      storyBible: {title: 'Story', summary: 'Summary', styleGuideId: 'paper'},
      characters: [
        {characterId: 'rabbit', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'left', depth: 'ground'}},
        {characterId: 'farmer', entityType: 'farmer', role: 'observer', initialBlocking: {horizontal: 'right', depth: 'ground'}},
      ],
      scenes: [{id: 'scene', sourceBeatIds: ['beat'], environmentIntent: 'field', summary: 'Field'}],
      narration: [], actions: [], blockingIntents: [],
    };
    expect(() => DirectorPlanSchema.parse({
      ...base,
      shots: [{id: 'shot', sceneId: 'scene', shotType: 'wide', focusEntityId: 'rabbit'}],
      cameraIntents: [{id: 'camera', sceneId: 'scene', shotId: 'shot', type: 'follow', focusEntityId: 'farmer'}],
    })).toThrow(/must match Shot focus/);
    expect(() => DirectorPlanSchema.parse({
      ...base,
      shots: [{id: 'shot', sceneId: 'scene', shotType: 'wide', composition: {subjectScreenX: 0.5, subjectScreenY: 0.7, leadRoom: 'center'}}],
      cameraIntents: [{id: 'camera', sceneId: 'scene', shotId: 'shot', type: 'static'}],
    })).toThrow(/composition requires Shot.focusEntityId/);
  });

  it('uses one Director entity ID namespace for characters and landmarks', () => {
    expect(() => DirectorPlanSchema.parse({
      schemaVersion: '1.0.0', projectId: 'project', storyId: 'story', sourceStoryHash: HASH,
      storyBible: {title: 'Story', summary: 'Summary', styleGuideId: 'paper'},
      characters: [{characterId: 'stump', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'left', depth: 'ground'}}],
      scenes: [{id: 'scene', sourceBeatIds: ['beat'], environmentIntent: 'field', summary: 'Field'}],
      landmarks: [{id: 'stump', sceneId: 'scene', landmarkType: 'stump', blocking: {horizontal: 'right', depth: 'ground'}}],
      shots: [{id: 'shot', sceneId: 'scene', shotType: 'wide'}],
      narration: [], actions: [],
      cameraIntents: [{id: 'camera', sceneId: 'scene', shotId: 'shot', type: 'static'}],
      blockingIntents: [],
    })).toThrow(/Duplicate director entity id: stump/);
  });

  it('binds overscan and safe bounds to the Environment contract', () => {
    const environment = {
      id: 'field', name: 'Field', referenceResolution: {width: 1280, height: 720},
      layers: [{id: 'ground', assetId: 'ground', renderLayer: 'ground', zIndex: 0, parallaxFactor: 1, transform}],
      ground: {farLeft: {x: 0, y: 0.5}, farRight: {x: 1, y: 0.5}, nearLeft: {x: 0, y: 1}, nearRight: {x: 1, y: 1}, farScale: 0.5, nearScale: 1, depthEasing: 'linear', walkableZones: []},
      occlusionZones: [], cameraSafeBounds: {minX: 440, maxX: 900, minY: 340, maxY: 380},
      coverageContract: {overscanScale: 1.5, minimumPixelCoverage: 0.995},
    };
    expect(EnvironmentDefinitionSchema.parse(environment).coverageContract?.overscanScale).toBe(1.5);
    expect(() => EnvironmentDefinitionSchema.parse({...environment, layers: [{...environment.layers[0], transform: {...transform, scale: {x: 1, y: 1}}}]})).toThrow(/overscanScale/);
  });

  it('rejects landmark bindings whose EntityDefinition type does not match', () => {
    expect(() => ResolvedAssetCatalogSchema.parse({
      schemaVersion: '1.0.0', mode: 'experiment', productionReady: false, catalogHash: HASH,
      assets: {schemaVersion: '1.0.0', assets: [{id: 'frame', kind: 'prop', uri: 'frame.png', contentHash: HASH, source: 'manual', qaStatus: 'passed', width: 10, height: 10, alphaMode: 'straight'}]},
      poseClips: [{id: 'rock.idle', entityType: 'rock', action: 'idle', loop: true, direction: 'front', frames: [{assetId: 'frame', durationFrames: 1, anchors: {foot: {x: 0.5, y: 1}, center: {x: 0.5, y: 0.5}}}], rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0}}],
      environments: [],
      entityDefinitions: [{id: 'rock-definition', entityType: 'rock', displayName: 'Rock', poseClipIds: ['rock.idle'], defaultPoseClipId: 'rock.idle', attachmentSlots: []}],
      characterBindings: [], landmarkBindings: [{landmarkType: 'stump', entityDefinitionId: 'rock-definition'}],
    })).toThrow(/mismatched/);
  });
});
