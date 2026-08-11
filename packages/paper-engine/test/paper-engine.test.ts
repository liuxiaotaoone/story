import {describe, expect, it} from 'vitest';
import {RenderStateSchema, type Timeline} from '@pose-clip/schemas';
import {
  applyEasing,
  calculateGroundLockVisualCorrectionPx,
  CANONICAL_RENDER_SIZE,
  evaluateFrame,
  evaluateNumberKeyframes,
  prepareRenderPlan,
  projectGround,
  resolveCameraSpacePoint,
  resolveCameraSpaceTransform,
  resolveGroundLock,
  resolveOwner,
  resolvePoseClipFrame,
  resolvePoseSelections,
  worldPointForLocalAnchor,
} from '../src/index.js';
import {demoRenderPlan} from './fixture.js';

const prepared = prepareRenderPlan(demoRenderPlan);

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('stateless numeric core', () => {
  it('evaluates easing and tracks deterministically', () => {
    expect(applyEasing('ease-in-out', 0.5)).toBe(0.5);
    const track = [{frame: 0, value: 0, easing: 'linear' as const}, {frame: 100, value: 10, easing: 'linear' as const}];
    expect(evaluateNumberKeyframes(track, 37)).toBe(3.7);
    expect(Array.from({length: 100}, () => evaluateNumberKeyframes(track, 37))).toEqual(Array(100).fill(3.7));
  });

  it('projects the MVP quadrilateral directly', () => {
    expect(projectGround(demoRenderPlan.environments[0]!, {u: 0.25, v: 0.5})).toEqual({
      worldFootPosition: {x: 352, y: 540}, perspectiveScale: 0.75, depth: 0.5,
    });
  });

  it('resolves arbitrary PoseClip frames without prior evaluation', () => {
    const clip = demoRenderPlan.poseClips.find(({id}) => id === 'farmer.walk')!;
    expect(resolvePoseClipFrame(clip, 137, 130).frame.assetId).toBe('farmer-walk-right');
    expect(resolvePoseClipFrame(clip, 147, 130).frame.assetId).toBe('farmer-walk-left');
  });
});

describe('PreparedRenderPlan boundary', () => {
  it('validates once, freezes the plan, and exposes read-only indexes', () => {
    expect(prepared.kind).toBe('prepared-render-plan-v1');
    expect(Object.isFrozen(prepared.plan)).toBe(true);
    expect(Object.isFrozen(prepared.plan.timeline)).toBe(true);
    expect(prepared.poseClipById.get('farmer.walk')?.id).toBe('farmer.walk');
    expect('set' in prepared.poseClipById).toBe(false);
  });

  it('requires every shot to provide an explicit CameraTrack starting at the shot frame', () => {
    const missing = structuredClone(demoRenderPlan);
    missing.timeline.cameraTracks = [];
    expect(() => prepareRenderPlan(missing)).toThrow(/explicit CameraTrack|MISSING_CAMERA_TRACK/iu);

    const late = structuredClone(demoRenderPlan);
    late.timeline.cameraTracks[0]!.position[0]!.frame = 1;
    expect(() => prepareRenderPlan(late)).toThrow(/start at frame 0|CAMERA_TRACK_START_MISMATCH/iu);
  });

  it('rejects invalid ownership before any frame is evaluated', () => {
    const invalid = structuredClone(demoRenderPlan);
    invalid.timeline.ownershipEvents[0]!.from = {kind: 'entity', entityId: 'rabbit', slot: 'bad'};
    expect(() => prepareRenderPlan(invalid)).toThrow(/ownership|slot|chain/iu);
  });

  it('rejects transition source mismatches, overlaps, and baked transfers during crossfade', () => {
    const mismatch = structuredClone(demoRenderPlan);
    mismatch.timeline.poseTransitions[0]!.fromPoseClipId = 'farmer.hold-rabbit';
    expect(() => prepareRenderPlan(mismatch)).toThrow(/active before|fromPoseClipId/iu);

    const overlap = structuredClone(demoRenderPlan);
    overlap.timeline.poseEvents.push({id: 'farmer-walk-again', frame: 31, entityId: 'farmer', poseClipId: 'farmer.walk', clipStartOffset: 0, playbackRate: 1});
    overlap.timeline.poseTransitions.push({id: 'overlap', entityId: 'farmer', fromPoseClipId: 'farmer.hold-rabbit', toPoseClipId: 'farmer.walk', startFrame: 31, durationFrames: 2, mode: 'crossfade', anchorPolicy: 'foot'});
    expect(() => prepareRenderPlan(overlap)).toThrow(/overlap/iu);

    const baked = structuredClone(demoRenderPlan);
    baked.timeline.ownershipEvents.find(({id}) => id === 'rabbit-attach')!.frame = 31;
    expect(() => prepareRenderPlan(baked)).toThrow(/Baked ownership|BAKED_DURING_CROSSFADE/iu);
  });
});

describe('true contact-segment GroundLock', () => {
  it('locks the reference foot to one world point for the entire contact segment', () => {
    const instance = prepared.entityInstanceById.get('farmer')!;
    const selection = resolvePoseSelections(prepared.plan.timeline, 'farmer', 'farmer.walk', 2)[0]!;
    const results = [0, 1, 2, 3].map((frame) => resolveGroundLock(prepared, instance, selection, frame, {width: 200, height: 400}, {x: 1, y: 1}, 0));
    expect(results.map(({segment}) => segment)).toEqual(Array(4).fill({startFrame: 0, endFrame: 4}));
    expect(new Set(results.map(({lockedWorldPoint}) => JSON.stringify(lockedWorldPoint))).size).toBe(1);
    expect(Math.max(...results.map(({correctionPx}) => correctionPx))).toBeLessThanOrEqual(30);
    expect(Math.max(...results.map(({visualCorrectionPx}) => visualCorrectionPx))).toBeLessThanOrEqual(30);
    expect(results.some(({correctionPx, visualCorrectionPx}) => visualCorrectionPx > correctionPx)).toBe(true);
    const spritePositions = [0, 1, 2, 3].map((frame) => evaluateFrame(prepared, frame).sprites.find(({entityId}) => entityId === 'farmer')!.transform.position);
    expect(new Set(spritePositions.map((position) => JSON.stringify(position))).size).toBe(1);
  });

  it('uses full Sprite top-left displacement for the correction limit', () => {
    const strict = structuredClone(demoRenderPlan);
    strict.poseClips.find(({id}) => id === 'farmer.walk')!.groundLock.maxCorrectionPx = 10;
    const strictPrepared = prepareRenderPlan(strict);
    expect(() => evaluateFrame(strictPrepared, 0)).toThrow(/visual correction/iu);
  });

  it('rotates anchor displacement into world space at 0, 45, and 90 degrees', () => {
    const args = [
      {x: 5, y: 0},
      {x: 0.5, y: 0.5},
      {x: 0.4, y: 0.5},
      {width: 100, height: 100},
      {x: 1, y: 1},
    ] as const;
    expect(calculateGroundLockVisualCorrectionPx(...args, 0)).toBeCloseTo(15);
    expect(calculateGroundLockVisualCorrectionPx(...args, Math.PI / 4)).toBeCloseTo(
      Math.hypot(5 + 10 / Math.sqrt(2), 10 / Math.sqrt(2)),
    );
    expect(calculateGroundLockVisualCorrectionPx(...args, Math.PI / 2)).toBeCloseTo(Math.hypot(5, 10));
  });

  it('returns the same result in random and sequential evaluation order', () => {
    const frames = [1, 19, 2, 31, 50, 79, 90, 3];
    const randomOrder = new Map(frames.map((frame) => [frame, JSON.stringify(evaluateFrame(prepared, frame))]));
    for (const frame of [...frames].sort((a, b) => a - b)) {
      expect(JSON.stringify(evaluateFrame(prepared, frame))).toBe(randomOrder.get(frame));
    }
  });
});

describe('event-centric Golden Fixture V2', () => {
  it('makes foot and center anchorPolicy produce distinct, internally aligned placements', () => {
    const footState = evaluateFrame(prepared, 31);
    const footSprites = footState.sprites.filter(({entityId}) => entityId === 'farmer');
    expect(footSprites).toHaveLength(2);
    expect(footSprites[0]?.anchor).toEqual({x: 0.5, y: 0.96});
    expect(footSprites[1]?.anchor).toEqual({x: 0.5, y: 0.96});
    expect(footSprites[0]?.transform.position).toEqual(footSprites[1]?.transform.position);

    const centerPlan = structuredClone(demoRenderPlan);
    centerPlan.timeline.poseTransitions[0]!.anchorPolicy = 'center';
    const centerState = evaluateFrame(prepareRenderPlan(centerPlan), 31);
    const centerSprites = centerState.sprites.filter(({entityId}) => entityId === 'farmer');
    expect(centerSprites[0]?.anchor).toEqual({x: 0.5, y: 0.5});
    expect(centerSprites[1]?.anchor).toEqual({x: 0.5, y: 0.5});
    expect(centerSprites[0]?.transform.position).toEqual(centerSprites[1]?.transform.position);
    expect(centerSprites[0]?.transform.position).not.toEqual(footSprites[0]?.transform.position);
  });

  it('uses independent transition weights and multiplies them into entity opacity', () => {
    const sprites = evaluateFrame(prepared, 31).sprites.filter(({entityId}) => entityId === 'farmer');
    expect(sprites).toHaveLength(2);
    expect(sprites[0]?.poseTransition?.weight).toBeCloseTo(2 / 3);
    expect(sprites[1]?.poseTransition?.weight).toBeCloseTo(1 / 3);
    expect(sprites.reduce((sum, {poseTransition}) => sum + (poseTransition?.weight ?? 0), 0)).toBeCloseTo(1);
    expect(sprites.reduce((sum, {transform}) => sum + transform.opacity, 0)).toBeCloseTo(0.8);
  });

  it('interpolates socket attachment transforms from both owner poses during crossfade', () => {
    const state = evaluateFrame(prepared, 31);
    const ownerSprites = state.sprites.filter(({entityId}) => entityId === 'farmer');
    const lantern = state.sprites.find(({entityId}) => entityId === 'lantern')!;
    const weightedAnchors = ownerSprites.map((sprite) => {
      const clip = sprite.poseTransition?.role === 'from'
        ? prepared.poseClipById.get('farmer.walk')!
        : prepared.poseClipById.get('farmer.hold-rabbit')!;
      const poseFrame = clip.frames.find(({assetId}) => assetId === sprite.assetId)!;
      const asset = prepared.assetById.get(sprite.assetId)!;
      if (!('width' in asset)) throw new Error('Expected visual owner asset');
      return {
        weight: sprite.poseTransition!.weight,
        point: worldPointForLocalAnchor(sprite.transform.position, sprite.anchor, poseFrame.anchors.rightHand!, {width: asset.width, height: asset.height}, sprite.transform.scale, sprite.transform.rotation),
      };
    });
    expect(lantern.transform.position.x).toBeCloseTo(weightedAnchors.reduce((sum, item) => sum + item.point.x * item.weight, 0));
    expect(lantern.transform.position.y).toBeCloseTo(weightedAnchors.reduce((sum, item) => sum + item.point.y * item.weight, 0));
    expect(lantern.transform.scale.x).toBeCloseTo(ownerSprites.reduce((sum, sprite) => sum + sprite.transform.scale.x * sprite.poseTransition!.weight, 0));
    expect(lantern.transform.rotation).toBeCloseTo(0);
  });

  it('resolves socket, baked composite, detach, effect, subtitle, and visibility events', () => {
    const at20 = evaluateFrame(prepared, 20);
    expect(at20.sprites.find(({entityId}) => entityId === 'lantern')?.owner).toEqual({kind: 'entity', entityId: 'farmer', slot: 'rightHand'});
    const at50 = evaluateFrame(prepared, 50);
    expect(at50.sprites.some(({entityId}) => entityId === 'rabbit')).toBe(false);
    expect(at50.effects.map(({effectId}) => effectId)).toContain('pickup-effect');
    expect(at50.subtitle?.cueId).toBe('subtitle-1');
    expect(evaluateFrame(prepared, 80).sprites.find(({entityId}) => entityId === 'lantern')?.owner.kind).toBe('world');
    expect(evaluateFrame(prepared, 90).sprites.find(({entityId}) => entityId === 'rabbit')?.owner.kind).toBe('world');
    expect(evaluateFrame(prepared, 100).sprites.some(({entityId}) => entityId === 'lantern')).toBe(false);
  });

  it('omits socket children when their valid owner is not renderable', () => {
    const hiddenOwner = structuredClone(demoRenderPlan);
    hiddenOwner.timeline.visibilityEvents.push({id: 'farmer-hide', frame: 70, entityId: 'farmer', visible: false});
    const hiddenState = evaluateFrame(prepareRenderPlan(hiddenOwner), 70);
    expect(hiddenState.sprites.some(({entityId}) => entityId === 'farmer')).toBe(false);
    expect(hiddenState.sprites.some(({entityId}) => entityId === 'lantern')).toBe(false);

    const expiredOwner = structuredClone(demoRenderPlan);
    expiredOwner.instances.find(({id}) => id === 'farmer')!.activeRange.endFrame = 70;
    const expiredState = evaluateFrame(prepareRenderPlan(expiredOwner), 70);
    expect(expiredState.sprites.some(({entityId}) => entityId === 'farmer')).toBe(false);
    expect(expiredState.sprites.some(({entityId}) => entityId === 'lantern')).toBe(false);
  });

  it('emits renderer-ready parallax contracts for four environment layers', () => {
    const environmentSprites = evaluateFrame(prepared, 60).sprites.filter(({entityId}) => entityId === undefined);
    expect(environmentSprites.map(({cameraSpace}) => cameraSpace)).toEqual([
      {kind: 'world', influence: 0.1}, {kind: 'world', influence: 0.35},
      {kind: 'world', influence: 0.7}, {kind: 'world', influence: 1.15},
    ]);
    const camera = evaluateFrame(prepared, 60).camera;
    expect(resolveCameraSpacePoint({x: 100, y: 100}, camera, {kind: 'screen'})).toEqual({x: 100, y: 100});
    expect(resolveCameraSpacePoint({x: 100, y: 100}, camera, {kind: 'world', influence: 1}).x).toBeLessThan(100);
  });

  it('freezes full camera position, scale, and rotation semantics', () => {
    const base = {position: {x: 640, y: 360}, scale: {x: 1.5, y: 2}, rotation: 0.2, opacity: 0.7};
    expect(resolveCameraSpaceTransform({
      transform: base,
      camera: {position: {x: 650, y: 360}, zoom: 2, rotation: 0},
      cameraSpace: {kind: 'world', influence: 1},
      viewport: {width: 1280, height: 720},
    })).toEqual({position: {x: 620, y: 360}, scale: {x: 3, y: 4}, rotation: 0.2, opacity: 0.7});
    const rotated = resolveCameraSpaceTransform({
      transform: {...base, position: {x: 740, y: 360}},
      camera: {position: {x: 640, y: 360}, zoom: 1, rotation: Math.PI / 2},
      cameraSpace: {kind: 'world', influence: 1},
      viewport: {width: 1280, height: 720},
    });
    expect(rotated.position.x).toBeCloseTo(640);
    expect(rotated.position.y).toBeCloseTo(260);
    expect(rotated.rotation).toBeCloseTo(0.2 - Math.PI / 2);
    expect(resolveCameraSpaceTransform({transform: base, camera: {position: {x: 1, y: 2}, zoom: 3, rotation: 1}, cameraSpace: {kind: 'screen'}, viewport: {width: 1280, height: 720}})).toEqual(base);
    expect(CANONICAL_RENDER_SIZE).toEqual({width: 1280, height: 720});
    expect(() => resolveCameraSpaceTransform({
      transform: base,
      camera: {position: {x: 640, y: 360}, zoom: 1, rotation: 0},
      cameraSpace: {kind: 'world', influence: 1},
      viewport: {width: 640, height: 360},
    })).toThrow(/canonical 1280x720/iu);
  });
});

describe('seeded property invariants', () => {
  it('holds determinism, ordering, ownership uniqueness, and legal crossfade limits', () => {
    const random = seeded(0x25d2026);
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const frame = Math.floor(random() * prepared.plan.timeline.durationFrames);
      const first = evaluateFrame(prepared, frame);
      const second = evaluateFrame(prepared, frame);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(RenderStateSchema.safeParse(first).success).toBe(true);
      expect(new Set(first.sprites.map(({stableSortKey}) => stableSortKey)).size).toBe(first.sprites.length);
      const visibleCounts = new Map<string, number>();
      for (const sprite of first.sprites) {
        if (sprite.visible && sprite.entityId !== undefined) visibleCounts.set(sprite.entityId, (visibleCounts.get(sprite.entityId) ?? 0) + 1);
      }
      expect(Math.max(0, ...visibleCounts.values())).toBeLessThanOrEqual(2);
    }
  });
});

describe('ownership resolver compatibility', () => {
  it('still resolves directly from event history', () => {
    const timeline = prepared.plan.timeline as Timeline;
    expect(resolveOwner(timeline, 'rabbit', {kind: 'world', environmentId: 'farm'}, 49).kind).toBe('world');
    expect(resolveOwner(timeline, 'rabbit', {kind: 'world', environmentId: 'farm'}, 50).kind).toBe('entity');
    expect(resolveOwner(timeline, 'rabbit', {kind: 'world', environmentId: 'farm'}, 90).kind).toBe('world');
  });
});
