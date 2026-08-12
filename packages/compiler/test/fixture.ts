import {DirectorPlanSchema, type CapabilityCatalog, type DirectorPlan} from '@pose-clip/schemas';

export const storyDirectorPlan: DirectorPlan = DirectorPlanSchema.parse({
  schemaVersion: '1.0.0',
  projectId: 'waiting-rabbit-m2',
  storyId: 'story.waiting-rabbit',
  storyBible: {
    title: 'Waiting by the Tree',
    summary: 'A farmer notices a rabbit after it runs into an old tree.',
    styleGuideId: 'warm-paper-cut',
  },
  characters: [
    {characterId: 'farmer', entityType: 'farmer', role: 'observer', initialBlocking: {horizontal: 'left', depth: 'ground', facing: 'right'}},
    {characterId: 'rabbit', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'far-right', depth: 'ground', facing: 'left'}},
  ],
  scenes: [{id: 'scene-field', sourceBeatIds: ['beat-run', 'beat-hit'], environmentIntent: 'pastoral-field', summary: 'An old tree at the edge of a field.'}],
  shots: [
    {id: 'shot-run', sceneId: 'scene-field', shotType: 'wide', focusEntityId: 'rabbit', durationPreference: {preferredSeconds: 8}},
    {id: 'shot-notice', sceneId: 'scene-field', shotType: 'medium', focusEntityId: 'farmer', durationPreference: {preferredSeconds: 6}},
  ],
  narration: [{
    id: 'narration-run', sceneId: 'scene-field', shotId: 'shot-run',
    text: 'A rabbit ran quickly. It hit the old tree!', voiceId: 'narrator', language: 'en-US', speed: 1,
  }],
  actions: [
    {id: 'action-run', sceneId: 'scene-field', shotId: 'shot-run', actorId: 'rabbit', action: 'run', direction: 'left', priority: 'required', enabled: true},
    {id: 'action-dance', sceneId: 'scene-field', shotId: 'shot-notice', actorId: 'farmer', action: 'dance', direction: 'right', priority: 'required', enabled: true},
  ],
  cameraIntents: [
    {id: 'camera-run', sceneId: 'scene-field', shotId: 'shot-run', type: 'follow', focusEntityId: 'rabbit'},
    {id: 'camera-notice', sceneId: 'scene-field', shotId: 'shot-notice', type: 'pan-left', focusEntityId: 'farmer'},
  ],
  blockingIntents: [
    {id: 'blocking-rabbit', sceneId: 'scene-field', shotId: 'shot-run', characterId: 'rabbit', blocking: {horizontal: 'right', depth: 'ground', facing: 'left'}},
    {id: 'blocking-farmer', sceneId: 'scene-field', shotId: 'shot-notice', characterId: 'farmer', blocking: {horizontal: 'left', depth: 'ground', facing: 'right'}},
  ],
});

export const capabilityCatalog: CapabilityCatalog = {
  schemaVersion: '1.0.0',
  catalogVersion: '1.0.0',
  entityCapabilities: [
    {
      entityType: 'rabbit', poseClips: ['rabbit.run-left'], attachmentSlots: [],
      actions: [{action: 'run', requiredPoseClips: ['rabbit.run-left'], minDurationFrames: 12, supportsDirections: ['left']}],
    },
    {
      entityType: 'farmer', poseClips: ['farmer.notice-right'], attachmentSlots: [],
      actions: [{action: 'notice', requiredPoseClips: ['farmer.notice-right'], minDurationFrames: 15, supportsDirections: ['right']}],
    },
  ],
  cameraCapabilities: [
    {intent: 'follow', minDurationFrames: 30, allowedShotTypes: ['wide']},
    {intent: 'pan-left', minDurationFrames: 30, allowedShotTypes: ['medium']},
  ],
  environmentCapabilities: [{
    environmentId: 'pastoral-field',
    allowedEntityTypes: ['farmer', 'rabbit'],
    supportedDepthIntents: ['ground'],
  }],
  fallbackRules: [{
    unsupportedAction: 'dance',
    replacementActions: ['notice'],
    reason: 'MVP replaces dance with a readable notice pose',
  }],
};
