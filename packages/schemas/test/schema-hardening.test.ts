import {describe, expect, it} from 'vitest';
import {
  AssetManifestSchema,
  AssetRecordSchema,
  ContentHashSchema,
  OwnershipEventSchema,
  RenderStateSchema,
  ShotTransitionSchema,
  TimelineSchema,
  Transform2DSchema,
  canonicalizeJson,
  canonicalHash,
  sha256Canonical,
  semanticRenderPlanHash,
  validateRenderPlanIntegrity,
} from '../src/index.js';

const worldOwner = {kind: 'world' as const, environmentId: 'farm'};
const HASH = '0'.repeat(64);

function timeline(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0',
    fps: 30,
    durationFrames: 60,
    shots: [{id: 'shot-1', sceneId: 'scene-1', environmentId: 'farm', range: {startFrame: 0, endFrame: 60}}],
    entityTracks: [],
    cameraTracks: [],
    poseEvents: [],
    poseTransitions: [],
    ownershipEvents: [],
    visibilityEvents: [],
    effectEvents: [],
    narration: [],
    subtitles: [],
    sfx: [],
    transitions: [],
    markers: [],
    ...overrides,
  };
}

function renderPlan(): Record<string, any> {
  const identity = {
    position: {x: 0, y: 0},
    scale: {x: 1, y: 1},
    rotation: 0,
    opacity: 1,
  };
  return {
    schemaVersion: '1.0.0',
    project: {
      id: 'demo',
      title: '守株待兔',
      fps: 30,
      resolution: {width: 1280, height: 720},
      sampleRate: 48_000,
      seed: 1,
      styleGuideId: 'style-1',
      capabilityCatalogVersion: '1.0.0',
    },
    assets: {
      schemaVersion: '1.0.0',
      assets: [
        {id: 'farm-far', kind: 'environment-layer', uri: 'farm-far.png', contentHash: HASH, source: 'manual', qaStatus: 'passed', width: 1280, height: 720, alphaMode: 'opaque'},
        {id: 'farmer-idle-frame', kind: 'character-frame', uri: 'farmer.png', contentHash: HASH, source: 'manual', qaStatus: 'passed', width: 400, height: 600, alphaMode: 'straight'},
      ],
    },
    environments: [{
      id: 'farm',
      name: 'Farm',
      referenceResolution: {width: 1280, height: 720},
      layers: [{id: 'far', assetId: 'farm-far', renderLayer: 'far', zIndex: 0, parallaxFactor: 0.1, transform: identity}],
      ground: {
        farLeft: {x: 0.1, y: 0.5},
        farRight: {x: 0.9, y: 0.5},
        nearLeft: {x: 0, y: 1},
        nearRight: {x: 1, y: 1},
        farScale: 0.5,
        nearScale: 1,
        depthEasing: 'linear',
        walkableZones: [],
      },
      occlusionZones: [],
    }],
    entities: [{
      id: 'farmer-def',
      entityType: 'farmer',
      displayName: 'Farmer',
      poseClipIds: ['farmer.idle'],
      defaultPoseClipId: 'farmer.idle',
      attachmentSlots: [],
    }],
    instances: [{
      id: 'farmer',
      definitionId: 'farmer-def',
      sceneId: 'scene-1',
      activeRange: {startFrame: 0, endFrame: 60},
      initialOwner: worldOwner,
    }],
    poseClips: [{
      id: 'farmer.idle',
      entityType: 'farmer',
      action: 'idle',
      loop: true,
      direction: 'right',
      frames: [{
        assetId: 'farmer-idle-frame',
        durationFrames: 30,
        anchors: {foot: {x: 0.5, y: 0.98}, center: {x: 0.5, y: 0.5}},
        contact: {type: 'both'},
      }],
      rootMotion: {mode: 'timeline'},
      groundLock: {mode: 'always', maxCorrectionPx: 3},
    }],
    timeline: timeline(),
    provenance: {
      compilerVersion: '1.0.0',
      sourceDirectorPlanHash: HASH,
      effectiveDirectorPlanHash: HASH,
      directorOverrideIds: [],
      capabilityCatalogVersion: '1.0.0',
      compiledAt: '2026-08-11T00:00:00.000Z',
      warnings: [],
    },
  };
}

describe('timeline hardening', () => {
  it('requires every keyframe track to be strictly increasing', () => {
    const result = TimelineSchema.safeParse(timeline({
      entityTracks: [{
        entityId: 'farmer',
        worldPosition: [
          {frame: 10, value: {x: 0, y: 0}, easing: 'linear'},
          {frame: 10, value: {x: 1, y: 1}, easing: 'linear'},
        ],
      }],
    }));
    expect(result.success).toBe(false);
  });

  it('requires shots to cover the complete timeline without gaps', () => {
    expect(TimelineSchema.safeParse(timeline({
      shots: [
        {id: 'shot-1', sceneId: 'scene-1', environmentId: 'farm', range: {startFrame: 0, endFrame: 20}},
        {id: 'shot-2', sceneId: 'scene-1', environmentId: 'farm', range: {startFrame: 21, endFrame: 60}},
      ],
    })).success).toBe(false);
  });

  it('rejects duplicate tracks and same-frame pose events', () => {
    expect(TimelineSchema.safeParse(timeline({
      entityTracks: [{entityId: 'farmer'}, {entityId: 'farmer'}],
      cameraTracks: [
        {shotId: 'shot-1', position: [{frame: 0, value: {x: 0, y: 0}, easing: 'hold'}], zoom: [{frame: 0, value: 1, easing: 'hold'}]},
        {shotId: 'shot-1', position: [{frame: 0, value: {x: 0, y: 0}, easing: 'hold'}], zoom: [{frame: 0, value: 1, easing: 'hold'}]},
      ],
      poseEvents: [
        {id: 'p1', frame: 5, entityId: 'farmer', poseClipId: 'idle', clipStartOffset: 0, playbackRate: 1},
        {id: 'p2', frame: 5, entityId: 'farmer', poseClipId: 'walk', clipStartOffset: 0, playbackRate: 1},
      ],
    })).success).toBe(false);
  });

  it('rejects non-positive scale/zoom and opacity outside 0..1', () => {
    expect(Transform2DSchema.safeParse({position: {x: 0, y: 0}, scale: {x: 0, y: 1}, rotation: 0, opacity: 1}).success).toBe(false);
    expect(TimelineSchema.safeParse(timeline({
      cameraTracks: [{shotId: 'shot-1', position: [{frame: 0, value: {x: 0, y: 0}, easing: 'hold'}], zoom: [{frame: 0, value: 0, easing: 'hold'}]}],
    })).success).toBe(false);
    expect(TimelineSchema.safeParse(timeline({
      entityTracks: [{entityId: 'farmer', opacity: [{frame: 0, value: 1.1, easing: 'hold'}]}],
    })).success).toBe(false);
  });
});

describe('version, provenance, transition, and detach hardening', () => {
  it('rejects future schema versions in V1 readers', () => {
    expect(AssetManifestSchema.safeParse({schemaVersion: '2.0.0', assets: []}).success).toBe(false);
  });

  it('requires provenance for generated assets', () => {
    expect(AssetRecordSchema.safeParse({
      id: 'generated-audio', kind: 'audio', uri: 'audio.wav', contentHash: HASH, source: 'generated', qaStatus: 'passed',
    }).success).toBe(false);
  });

  it('allows detach from a socket without repeating socketBinding', () => {
    expect(OwnershipEventSchema.safeParse({
      id: 'detach-1', frame: 20, type: 'detach', entityId: 'lantern',
      from: {kind: 'entity', entityId: 'farmer', slot: 'rightHand'},
      to: worldOwner, mode: 'socket', preserveWorldTransform: true,
    }).success).toBe(true);
  });

  it('represents cuts as an instantaneous frame', () => {
    expect(ShotTransitionSchema.safeParse({id: 'cut-1', fromShotId: 'a', toShotId: 'b', type: 'cut', frame: 30}).success).toBe(true);
    expect(ShotTransitionSchema.safeParse({id: 'cut-1', fromShotId: 'a', toShotId: 'b', type: 'cut', range: {startFrame: 30, endFrame: 31}}).success).toBe(false);
  });
});

describe('canonical hashing and render-plan integrity', () => {
  it('accepts only lowercase 64-character SHA-256 content hashes', () => {
    expect(ContentHashSchema.safeParse(HASH).success).toBe(true);
    expect(ContentHashSchema.safeParse('0'.repeat(63)).success).toBe(false);
    expect(ContentHashSchema.safeParse('A'.repeat(64)).success).toBe(false);
  });

  it('uses canonical key ordering and SHA-256 over UTF-8', async () => {
    expect(canonicalizeJson({b: 1, a: 2})).toBe('{"a":2,"b":1}');
    await expect(sha256Canonical({b: 1, a: 2})).resolves.toBe('d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772');
    await expect(canonicalHash('asset', {a: 1})).resolves.not.toBe(await canonicalHash('task', {a: 1}));
  });

  it('detects references that local schemas cannot validate', () => {
    const valid = renderPlan();
    expect(validateRenderPlanIntegrity(valid).valid).toBe(true);
    const invalid = structuredClone(valid);
    invalid.environments[0]!.layers[0]!.assetId = 'missing-layer';
    const result = validateRenderPlanIntegrity(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.some(({code}) => code === 'MISSING_ASSET')).toBe(true);
  });

  it('keeps semantic RenderPlan identity stable across audit-only changes', async () => {
    const first = renderPlan();
    const second = structuredClone(first);
    second.provenance.compiledAt = '2026-08-12T00:00:00.000Z';
    second.provenance.warnings = [{code: 'AUDIT_NOTE', message: 'Review only'}];
    await expect(semanticRenderPlanHash(first as never)).resolves.toBe(await semanticRenderPlanHash(second as never));
    second.timeline.durationFrames = 61;
    await expect(semanticRenderPlanHash(first as never)).resolves.not.toBe(await semanticRenderPlanHash(second as never));
  });
});

describe('ownership timeline integrity', () => {
  function planWithSecondEntity() {
    const plan = renderPlan();
    plan.entities[0]!.attachmentSlots = [{id: 'hand', ownerAnchor: 'center'}];
    plan.entities.push({...structuredClone(plan.entities[0]!), id: 'rabbit-def', displayName: 'Rabbit'});
    plan.instances.push({...structuredClone(plan.instances[0]!), id: 'rabbit', definitionId: 'rabbit-def'});
    return plan;
  }

  const binding = {attachmentAnchorId: 'grip', inheritRotation: false, inheritScale: false};

  it('rejects duplicate same-frame events and stale from chains', () => {
    const plan = planWithSecondEntity();
    const attach = {id: 'a1', frame: 10, type: 'attach', entityId: 'rabbit', from: worldOwner, to: {kind: 'entity', entityId: 'farmer', slot: 'hand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: binding};
    plan.timeline.ownershipEvents = [attach, {...attach, id: 'a2'}];
    const result = validateRenderPlanIntegrity(plan);
    expect(result.issues.some(({code}) => code === 'DUPLICATE_OWNERSHIP_EVENT')).toBe(true);
    plan.timeline.ownershipEvents = [{...attach, from: {kind: 'world', environmentId: 'wrong'}}];
    expect(validateRenderPlanIntegrity(plan).issues.some(({code}) => code === 'STALE_OWNERSHIP_FROM')).toBe(true);
  });

  it('rejects self attachment, cycles, and ownership depth greater than one', () => {
    const self = planWithSecondEntity();
    self.timeline.ownershipEvents = [{id: 'self', frame: 1, type: 'attach', entityId: 'farmer', from: worldOwner, to: {kind: 'entity', entityId: 'farmer', slot: 'hand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: binding}];
    expect(validateRenderPlanIntegrity(self).issues.some(({code}) => code === 'SELF_ATTACHMENT')).toBe(true);

    const cycle = planWithSecondEntity();
    cycle.timeline.ownershipEvents = [
      {id: 'c1', frame: 1, type: 'attach', entityId: 'farmer', from: worldOwner, to: {kind: 'entity', entityId: 'rabbit', slot: 'hand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: binding},
      {id: 'c2', frame: 1, type: 'attach', entityId: 'rabbit', from: worldOwner, to: {kind: 'entity', entityId: 'farmer', slot: 'hand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: binding},
    ];
    expect(validateRenderPlanIntegrity(cycle).issues.some(({code}) => code === 'OWNERSHIP_CYCLE')).toBe(true);

    const deep = planWithSecondEntity();
    deep.entities.push({...structuredClone(deep.entities[0]!), id: 'lantern-def', displayName: 'Lantern'});
    deep.instances.push({...structuredClone(deep.instances[0]!), id: 'lantern', definitionId: 'lantern-def'});
    deep.timeline.ownershipEvents = [
      {id: 'd1', frame: 1, type: 'attach', entityId: 'rabbit', from: worldOwner, to: {kind: 'entity', entityId: 'farmer', slot: 'hand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: binding},
      {id: 'd2', frame: 2, type: 'attach', entityId: 'lantern', from: worldOwner, to: {kind: 'entity', entityId: 'rabbit', slot: 'hand'}, mode: 'socket', preserveWorldTransform: false, socketBinding: binding},
    ];
    expect(validateRenderPlanIntegrity(deep).issues.some(({code}) => code === 'OWNERSHIP_DEPTH_EXCEEDED')).toBe(true);
  });
});

describe('canonical RenderState ordering', () => {
  const sprite = (entityId: string, layer: 'far' | 'characters', stableSortKey: string) => ({
    renderId: `${entityId}-render`, entityId, assetId: `${entityId}-asset`,
    transform: {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1},
    anchor: {x: 0.5, y: 1}, renderLayer: layer, zIndex: 0, depth: 0.5,
    stableSortKey, visible: true, owner: worldOwner, cameraSpace: {kind: 'world', influence: 1},
  });

  it('requires sprites to arrive already sorted', () => {
    const base = {frame: 0, shotId: 'shot-1', environmentId: 'farm', camera: {position: {x: 0, y: 0}, zoom: 1, rotation: 0}, effects: []};
    expect(RenderStateSchema.safeParse({...base, sprites: [sprite('background', 'far', 'a'), sprite('farmer', 'characters', 'b')]}).success).toBe(true);
    expect(RenderStateSchema.safeParse({...base, sprites: [sprite('farmer', 'characters', 'b'), sprite('background', 'far', 'a')]}).success).toBe(false);
  });
});
