import {describe, expect, it} from 'vitest';
import {
  AssetRecordSchema,
  DirectorOverrideSchema,
  FinalCompileInputSchema,
  OwnershipEventSchema,
  PoseClipSchema,
  RenderStateSchema,
  TaskNodeSchema,
  TimelineSchema,
  effectivePoseSwitchFrame,
  taskCacheKeyMaterial,
  canonicalizeJson,
} from '../src/index.js';

const point = {x: 0.5, y: 0.9};
const worldOwner = {kind: 'world' as const, environmentId: 'farm'};
const HASH = '0'.repeat(64);

function timelineWith(options: {
  poseEvents?: unknown[];
  poseTransitions?: unknown[];
} = {}) {
  return {
    schemaVersion: '1.0.0',
    fps: 30,
    durationFrames: 60,
    shots: [{
      id: 'shot-1',
      sceneId: 'scene-1',
      environmentId: 'farm',
      range: {startFrame: 0, endFrame: 60},
    }],
    entityTracks: [],
    cameraTracks: [],
    poseEvents: options.poseEvents ?? [],
    poseTransitions: options.poseTransitions ?? [],
    ownershipEvents: [],
    visibilityEvents: [],
    effectEvents: [],
    narration: [],
    subtitles: [],
    sfx: [],
    transitions: [],
    markers: [],
  };
}

function sprite(overrides: Record<string, unknown> = {}) {
  return {
    renderId: 'farmer-main',
    entityId: 'farmer',
    assetId: 'farmer-idle',
    transform: {
      position: {x: 100, y: 500},
      scale: {x: 1, y: 1},
      rotation: 0,
      opacity: 1,
    },
    anchor: point,
    renderLayer: 'characters',
    zIndex: 0,
    depth: 0.6,
    stableSortKey: 'farmer:main',
    visible: true,
    owner: worldOwner,
    cameraSpace: {kind: 'world', influence: 1},
    ...overrides,
  };
}

function renderState(sprites: unknown[]) {
  return {
    frame: 10,
    shotId: 'shot-1',
    environmentId: 'farm',
    camera: {position: {x: 0, y: 0}, zoom: 1, rotation: 0},
    sprites,
    effects: [],
  };
}

describe('asset contracts', () => {
  it('requires dimensions for every visual asset', () => {
    const result = AssetRecordSchema.safeParse({
      id: 'farmer-idle',
      kind: 'character-frame',
      uri: 'assets/farmer-idle.png',
      contentHash: HASH,
      source: 'manual',
      qaStatus: 'passed',
      alphaMode: 'straight',
    });
    expect(result.success).toBe(false);
  });

  it('allows audio without image dimensions', () => {
    const result = AssetRecordSchema.safeParse({
      id: 'narration-1',
      kind: 'audio',
      uri: 'audio/narration-1.wav',
      contentHash: HASH,
      source: 'manual',
      qaStatus: 'passed',
    });
    expect(result.success).toBe(true);
  });
});

describe('pose clip contracts', () => {
  const baseClip = {
    id: 'farmer.walk.right',
    entityType: 'farmer',
    action: 'walk',
    loop: true,
    direction: 'right',
    rootMotion: {mode: 'timeline'},
    groundLock: {mode: 'contact-only', maxCorrectionPx: 3},
    frames: [{
      assetId: 'walk-1',
      durationFrames: 3,
      anchors: {foot: point, center: {x: 0.5, y: 0.5}},
      contact: {type: 'left-foot'},
      referenceFoot: 'auto',
    }],
  };

  it('requires the contact foot anchor for contact-only ground lock', () => {
    expect(PoseClipSchema.safeParse(baseClip).success).toBe(false);
    expect(PoseClipSchema.safeParse({
      ...baseClip,
      frames: [{
        ...baseClip.frames[0],
        anchors: {...baseClip.frames[0]?.anchors, leftFoot: {x: 0.42, y: 0.96}},
      }],
    }).success).toBe(true);
  });
});

describe('attachment contracts', () => {
  const baseEvent = {
    id: 'attach-lantern',
    frame: 30,
    type: 'attach',
    entityId: 'lantern',
    from: worldOwner,
    to: {kind: 'entity', entityId: 'farmer', slot: 'rightHand'},
    mode: 'socket',
    preserveWorldTransform: false,
  };

  it('requires the child attachment anchor binding for socket mode', () => {
    expect(OwnershipEventSchema.safeParse(baseEvent).success).toBe(false);
    expect(OwnershipEventSchema.safeParse({
      ...baseEvent,
      socketBinding: {
        attachmentAnchorId: 'grip',
        inheritRotation: true,
        inheritScale: true,
      },
    }).success).toBe(true);
  });
});

describe('pose transition contracts', () => {
  const holdTransition = {
    id: 'bend-to-hold',
    entityId: 'farmer',
    fromPoseClipId: 'farmer.bend',
    toPoseClipId: 'farmer.hold',
    startFrame: 10,
    durationFrames: 5,
    mode: 'hold-then-cut',
    anchorPolicy: 'foot',
  } as const;

  it('defines the hold-then-cut switch at the end of the hold', () => {
    expect(effectivePoseSwitchFrame(holdTransition)).toBe(15);
    expect(TimelineSchema.safeParse(timelineWith({
      poseTransitions: [holdTransition],
      poseEvents: [{
        id: 'pose-hold',
        frame: 15,
        entityId: 'farmer',
        poseClipId: 'farmer.hold',
        clipStartOffset: 0,
        playbackRate: 1,
      }],
    })).success).toBe(true);
  });

  it('rejects a hold-then-cut pose event at startFrame', () => {
    expect(TimelineSchema.safeParse(timelineWith({
      poseTransitions: [holdTransition],
      poseEvents: [{
        id: 'pose-hold',
        frame: 10,
        entityId: 'farmer',
        poseClipId: 'farmer.hold',
        clipStartOffset: 0,
        playbackRate: 1,
      }],
    })).success).toBe(false);
  });

  it('allows center only for crossfade transitions in v0.1', () => {
    const poseEvent = {id: 'pose-next', frame: 10, entityId: 'farmer', poseClipId: 'farmer.next', clipStartOffset: 0, playbackRate: 1};
    const common = {id: 'transition-next', entityId: 'farmer', fromPoseClipId: 'farmer.idle', toPoseClipId: 'farmer.next', startFrame: 10, anchorPolicy: 'center'};
    expect(TimelineSchema.safeParse(timelineWith({
      poseEvents: [poseEvent],
      poseTransitions: [{...common, durationFrames: 0, mode: 'cut'}],
    })).success).toBe(false);
    expect(TimelineSchema.safeParse(timelineWith({
      poseEvents: [{...poseEvent, frame: 15}],
      poseTransitions: [{...common, durationFrames: 5, mode: 'hold-then-cut'}],
    })).success).toBe(false);
    expect(TimelineSchema.safeParse(timelineWith({
      poseEvents: [poseEvent],
      poseTransitions: [{...common, durationFrames: 3, mode: 'crossfade'}],
    })).success).toBe(true);
  });
});

describe('deterministic render-state contracts', () => {
  it('allows exactly two complementary sprites for a legal crossfade', () => {
    const from = sprite({
      renderId: 'farmer:transition:from',
      stableSortKey: 'farmer:transition:0:from',
      transform: {...sprite().transform, opacity: 0.25},
      poseTransition: {transitionId: 'transition-1', role: 'from', weight: 0.25},
    });
    const to = sprite({
      renderId: 'farmer:transition:to',
      stableSortKey: 'farmer:transition:1:to',
      transform: {...sprite().transform, opacity: 0.75},
      poseTransition: {transitionId: 'transition-1', role: 'to', weight: 0.75},
    });
    expect(RenderStateSchema.safeParse(renderState([from, to])).success).toBe(true);
  });

  it('rejects duplicate entity sprites outside a legal crossfade', () => {
    expect(RenderStateSchema.safeParse(renderState([
      sprite(),
      sprite({renderId: 'farmer-copy', stableSortKey: 'farmer:copy'}),
    ])).success).toBe(false);
  });

  it('rejects duplicate stable sort keys', () => {
    expect(RenderStateSchema.safeParse(renderState([
      sprite(),
      sprite({renderId: 'rabbit', entityId: 'rabbit'}),
    ])).success).toBe(false);
  });
});

describe('two-stage compiler contracts', () => {
  const preflight = {
    schemaVersion: '1.0.0',
    effectiveDirectorPlanHash: HASH,
    capabilityCatalogVersion: '1.0.0',
    capabilityCatalogHash: HASH,
    narrationSegments: [{
      id: 'segment-1', narrationIntentId: 'narration-1', shotId: 'shot-1', sequence: 0,
      text: 'A farmer waited by the tree.', language: 'en',
    }],
    expandedActions: [],
    ttsRequests: [{
      id: 'tts-1',
      segmentId: 'segment-1',
      text: '从前有一个农夫。',
      voiceId: 'narrator',
      speed: 1,
      language: 'zh-CN',
      inputHash: HASH,
    }],
    assetRequirements: [],
    diagnostics: [],
  };

  it('requires measured audio for every TTS requirement before final compile', () => {
    const effectiveDirectorPlan = {
      sourceDirectorPlanHash: HASH,
      overrideIds: [],
      effectivePlanHash: HASH,
      plan: {
        schemaVersion: '1.0.0', projectId: 'project-1', storyId: 'story-1', sourceStoryHash: HASH,
        storyBible: {title: 'Story', summary: 'Summary', styleGuideId: 'paper'},
        characters: [{characterId: 'farmer', entityType: 'farmer', role: 'observer', initialBlocking: {horizontal: 'left', depth: 'ground'}}],
        scenes: [{id: 'scene-1', sourceBeatIds: ['beat-1'], environmentIntent: 'field', summary: 'Field'}],
        shots: [{id: 'shot-1', sceneId: 'scene-1', shotType: 'wide'}],
        narration: [], actions: [],
        cameraIntents: [{id: 'camera-1', sceneId: 'scene-1', shotId: 'shot-1', type: 'static'}],
        blockingIntents: [],
      },
    };
    const capabilityCatalog = {
      schemaVersion: '1.0.0', catalogVersion: '1.0.0', entityCapabilities: [],
      cameraCapabilities: [], environmentCapabilities: [], fallbackRules: [],
    };
    expect(FinalCompileInputSchema.safeParse({effectiveDirectorPlan, preflight, measuredAudio: [], capabilityCatalog}).success).toBe(false);
    expect(FinalCompileInputSchema.safeParse({
      effectiveDirectorPlan,
      preflight,
      capabilityCatalog,
      measuredAudio: [{
        requestId: 'tts-1',
        assetId: 'audio-1',
        sampleRate: 48_000,
        sampleLength: 48_000,
        channels: 1,
        contentHash: HASH,
        measurementProducer: {name: 'ffprobe-wrapper', version: '1.0.0'},
      }],
    }).success).toBe(true);
  });
});

describe('override and task provenance contracts', () => {
  it('requires values for replace/insert and forbids them for remove', () => {
    const base = {
      id: 'override-1',
      sourceDirectorPlanHash: HASH,
      targetPath: '/cameraIntents/0/type',
      reason: 'Composition review',
      createdBy: 'reviewer',
      createdAt: '2026-08-10T00:00:00.000Z',
    };
    expect(DirectorOverrideSchema.safeParse({...base, operation: 'replace'}).success).toBe(false);
    expect(DirectorOverrideSchema.safeParse({...base, operation: 'replace', value: 'pan-right'}).success).toBe(true);
    expect(DirectorOverrideSchema.safeParse({...base, operation: 'remove', value: 'bad'}).success).toBe(false);
    expect(DirectorOverrideSchema.safeParse({...base, targetPath: '/characters/0/role', operation: 'replace', value: 'lead'}).success).toBe(false);
  });

  it('changes cache identity when the producing tool version changes', () => {
    const task = TaskNodeSchema.parse({
      nodeId: 'anchor-task-1',
      type: 'anchor-estimation',
      inputHash: HASH,
      workflowVersion: '1.0.0',
      producer: {name: 'anchor-estimator', version: '1.3.0'},
      dependencies: [],
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    });
    const oldKey = taskCacheKeyMaterial(task);
    const newKey = taskCacheKeyMaterial({...task, producer: {...task.producer, version: '1.4.0'}});
    expect(newKey).not.toBe(oldKey);
  });

  it('preserves dependency role and node identity in cache material', () => {
    const base = TaskNodeSchema.parse({
      nodeId: 'compose', type: 'compose', inputHash: HASH, workflowVersion: '1.0.0',
      producer: {name: 'compiler', version: '1.0.0'},
      dependencies: [{role: 'character', nodeId: 'asset-a', outputHash: HASH}],
      status: 'pending', attempts: 0,
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    });
    const changedRole = {...base, dependencies: [{...base.dependencies[0]!, role: 'background'}]};
    expect(taskCacheKeyMaterial(changedRole)).not.toBe(taskCacheKeyMaterial(base));
    expect(taskCacheKeyMaterial(base)).toBe(canonicalizeJson(JSON.parse(taskCacheKeyMaterial(base))));
    expect(taskCacheKeyMaterial({...base, promptHash: HASH})).not.toBe(
      taskCacheKeyMaterial({...base, promptHash: '1'.repeat(64)}),
    );
  });
});
