import {describe, expect, it} from 'vitest';
import {
  ActionCapabilitySchema,
  DirectorPlanSchema,
  MeasuredAudioSchema,
  PreflightCompileResultSchema,
  StorySchema,
  measuredAudioDurationSeconds,
  ExpandedActionSchema,
} from '../src/index.js';

const HASH = '0'.repeat(64);

const minimalDirectorPlan = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  storyId: 'story-1',
  sourceStoryHash: HASH,
  storyBible: {title: 'A Story', summary: 'A short story.', styleGuideId: 'paper-cut'},
  characters: [{
    characterId: 'farmer', entityType: 'farmer', role: 'observer',
    initialBlocking: {horizontal: 'left', depth: 'ground', facing: 'right'},
  }],
  scenes: [{id: 'scene-1', sourceBeatIds: ['beat-1'], environmentIntent: 'field', summary: 'A field.'}],
  shots: [{id: 'shot-1', sceneId: 'scene-1', shotType: 'wide', focusEntityId: 'farmer'}],
  narration: [],
  actions: [],
  cameraIntents: [{id: 'camera-1', sceneId: 'scene-1', shotId: 'shot-1', type: 'static'}],
  blockingIntents: [],
};

describe('M2 semantic boundary contracts', () => {
  it('rejects zero-duration required action capability and expansion', () => {
    expect(ActionCapabilitySchema.safeParse({
      action: 'impact', requiredPoseClips: [], poseBindings: [], minDurationFrames: 0, supportsDirections: ['front'],
      completionPolicy: 'hold', spatialMode: 'stationary',
    }).success).toBe(false);
    expect(ExpandedActionSchema.safeParse({
      id: 'expanded-impact', sourceActionId: 'impact', sceneId: 'scene-1', shotId: 'shot-1',
      actorId: 'farmer', action: 'impact', sequence: 0, direction: 'front', priority: 'required',
      minDurationFrames: 0, poseClipId: 'farmer.impact', requiredPoseClipIds: [],
      completionPolicy: 'hold', spatialMode: 'stationary',
    }).success).toBe(false);
  });
  it('keeps Story references valid and rejects unknown beat participants', () => {
    const story = {
      schemaVersion: '1.0.0', id: 'story-1', title: 'A Story', language: 'en-US', domain: 'fable',
      synopsis: 'A farmer waits.',
      characters: [{id: 'farmer', entityType: 'farmer', description: 'A farmer.', traits: ['patient']}],
      beats: [{id: 'beat-1', summary: 'The farmer waits.', participantIds: ['rabbit']}],
    };
    expect(StorySchema.safeParse(story).success).toBe(false);
  });

  it('forbids frame, pixel, asset and Renderer fields in DirectorPlan', () => {
    for (const illegal of [
      {frame: 10},
      {pixelPosition: {x: 1, y: 2}},
      {assetRequirements: []},
      {timeline: {}},
      {pixi: {}},
    ]) {
      expect(DirectorPlanSchema.safeParse({...minimalDirectorPlan, ...illegal}).success).toBe(false);
    }
    expect(DirectorPlanSchema.safeParse(minimalDirectorPlan).success).toBe(true);
  });

  it('defines Preflight as compile input rather than a second Timeline', () => {
    const preflight = {
      schemaVersion: '1.0.0', effectiveDirectorPlanHash: HASH,
      capabilityCatalogVersion: '1.0.0', capabilityCatalogHash: HASH,
      narrationSegments: [], ttsRequests: [], assetRequirements: [], expandedActions: [], diagnostics: [],
      preflightHash: HASH,
    };
    expect(PreflightCompileResultSchema.safeParse(preflight).success).toBe(true);
    expect(PreflightCompileResultSchema.safeParse({...preflight, timeline: {}}).success).toBe(false);
  });

  it('requires explicit spatial and follow-camera semantics', () => {
    const locomotion = {
      id: 'expanded-run', sourceActionId: 'run', sceneId: 'scene-1', shotId: 'shot-1',
      actorId: 'farmer', action: 'run', sequence: 0, direction: 'left', priority: 'required',
      minDurationFrames: 12, poseClipId: 'farmer.run-left', requiredPoseClipIds: ['farmer.run-left'],
      completionPolicy: 'return-default', spatialMode: 'locomotion',
    };
    expect(ExpandedActionSchema.safeParse(locomotion).success).toBe(false);
    expect(ExpandedActionSchema.safeParse({
      ...locomotion, destinationBlocking: {horizontal: 'left', depth: 'ground'},
    }).success).toBe(true);
    expect(DirectorPlanSchema.safeParse({
      ...minimalDirectorPlan,
      cameraIntents: [{id: 'camera-follow', sceneId: 'scene-1', shotId: 'shot-1', type: 'follow'}],
    }).success).toBe(false);
  });

  it('requires unique blocking targets and sequential action slots per shot', () => {
    const action = {
      id: 'action-1', sceneId: 'scene-1', shotId: 'shot-1', actorId: 'farmer',
      action: 'wait', sequence: 0, priority: 'required', enabled: true,
    };
    const blocking = {
      id: 'blocking-1', sceneId: 'scene-1', shotId: 'shot-1', characterId: 'farmer',
      blocking: {horizontal: 'left', depth: 'ground'},
    };
    expect(DirectorPlanSchema.safeParse({
      ...minimalDirectorPlan,
      actions: [action, {...action, id: 'action-2'}],
    }).success).toBe(false);
    expect(DirectorPlanSchema.safeParse({
      ...minimalDirectorPlan,
      blockingIntents: [blocking, {...blocking, id: 'blocking-2'}],
    }).success).toBe(false);
  });

  it('requires valid Camera focus and unique Narration sequence per shot', () => {
    const narration = {
      id: 'narration-1', sceneId: 'scene-1', shotId: 'shot-1', sequence: 0,
      text: 'The farmer waits.', voiceId: 'narrator', language: 'en-US', speed: 1,
    };
    expect(DirectorPlanSchema.safeParse({
      ...minimalDirectorPlan,
      cameraIntents: [{...minimalDirectorPlan.cameraIntents[0], focusEntityId: 'ghost'}],
    }).success).toBe(false);
    expect(DirectorPlanSchema.safeParse({
      ...minimalDirectorPlan,
      narration: [narration, {...narration, id: 'narration-2'}],
    }).success).toBe(false);
  });

  it('derives audio duration from integer sampleFrameCount/sampleRate only', () => {
    const audio = {
      requestId: 'tts-1', sourceTtsRequestHash: HASH, assetId: 'audio-1', sampleRate: 48_000, sampleFrameCount: 72_000,
      channels: 1, contentHash: HASH, measurementProducer: {name: 'wav-parser', version: '1.0.0'},
    };
    expect(MeasuredAudioSchema.safeParse({...audio, durationSeconds: 1.5}).success).toBe(false);
    expect(MeasuredAudioSchema.safeParse({...audio, sampleFrameCount: undefined, sampleLength: 72_000}).success).toBe(false);
    expect(measuredAudioDurationSeconds(MeasuredAudioSchema.parse(audio))).toBe(1.5);
  });
});
