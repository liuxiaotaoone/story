import {describe, expect, it} from 'vitest';
import type {PoseClip, Timeline} from '@pose-clip/schemas';
import {
  applyEasing,
  evaluateFrame,
  evaluateNumberKeyframes,
  projectGround,
  resolveGroundLockAnchor,
  resolveOwner,
  resolvePoseClipFrame,
} from '../src/index.js';
import frame0 from './golden/frame-0.json' with {type: 'json'};
import frame30 from './golden/frame-30.json' with {type: 'json'};
import frame60 from './golden/frame-60.json' with {type: 'json'};
import frame90 from './golden/frame-90.json' with {type: 'json'};
import {demoRenderPlan} from './fixture.js';

describe('interpolation', () => {
  it('evaluates all easing modes without mutable state', () => {
    expect(applyEasing('linear', 0.5)).toBe(0.5);
    expect(applyEasing('ease-in', 0.5)).toBe(0.25);
    expect(applyEasing('ease-out', 0.5)).toBe(0.75);
    expect(applyEasing('ease-in-out', 0.5)).toBe(0.5);
    expect(applyEasing('hold', 0.9)).toBe(0);
    const track = [
      {frame: 0, value: 0, easing: 'linear' as const},
      {frame: 100, value: 10, easing: 'linear' as const},
    ];
    expect(evaluateNumberKeyframes(track, 0)).toBe(0);
    expect(evaluateNumberKeyframes(track, 1)).toBe(0.1);
    expect(evaluateNumberKeyframes(track, 100)).toBe(10);
    expect(Array.from({length: 100}, () => evaluateNumberKeyframes(track, 37))).toEqual(Array(100).fill(3.7));
  });
});

describe('ground projection', () => {
  it('projects the MVP quadrilateral with bilinear interpolation', () => {
    const environment = demoRenderPlan.environments[0]!;
    expect(projectGround(environment, {u: 0.25, v: 0.5})).toEqual({
      worldFootPosition: {x: 352, y: 540},
      perspectiveScale: 0.75,
      depth: 0.5,
    });
  });
});

describe('pose runtime', () => {
  const clip: PoseClip = {
    id: 'farmer.walk', entityType: 'farmer', action: 'walk', loop: true, direction: 'right',
    frames: [
      {assetId: 'walk-1', durationFrames: 3, anchors: {foot: {x: 0.5, y: 1}, center: {x: 0.5, y: 0.5}}},
      {assetId: 'walk-2', durationFrames: 3, anchors: {foot: {x: 0.5, y: 1}, center: {x: 0.5, y: 0.5}}},
      {assetId: 'walk-3', durationFrames: 4, anchors: {foot: {x: 0.5, y: 1}, center: {x: 0.5, y: 0.5}}},
    ],
    rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0},
  };

  it('resolves an arbitrary frame directly', () => {
    expect(resolvePoseClipFrame(clip, 137, 130).frame.assetId).toBe('walk-3');
    expect(resolvePoseClipFrame(clip, 147, 130).frame.assetId).toBe('walk-3');
  });

  it('enforces the ground-lock correction cap', () => {
    const locked: PoseClip = {
      ...clip,
      groundLock: {mode: 'contact-only', maxCorrectionPx: 3},
      frames: [{
        assetId: 'walk-1', durationFrames: 3,
        anchors: {foot: {x: 0.5, y: 1}, leftFoot: {x: 0.4, y: 1}, center: {x: 0.5, y: 0.5}},
        contact: {type: 'left-foot'}, referenceFoot: 'auto',
      }],
    };
    expect(() => resolveGroundLockAnchor(locked, locked.frames[0]!, {width: 100, height: 200}, {x: 1, y: 1})).toThrow(/exceeds/u);
  });
});

describe('ownership', () => {
  it('resolves directly from the event history at the target frame', () => {
    const base = demoRenderPlan.timeline as Timeline;
    const timeline: Timeline = {
      ...base,
      ownershipEvents: [
        {
          id: 'attach', frame: 10, type: 'attach', entityId: 'rabbit',
          from: {kind: 'world', environmentId: 'farm'},
          to: {kind: 'entity', entityId: 'farmer', slot: 'rightHand'},
          mode: 'baked', preserveWorldTransform: false,
        },
        {
          id: 'detach', frame: 20, type: 'detach', entityId: 'rabbit',
          from: {kind: 'entity', entityId: 'farmer', slot: 'rightHand'},
          to: {kind: 'world', environmentId: 'farm'},
          mode: 'baked', preserveWorldTransform: true,
        },
      ],
    };
    expect(resolveOwner(timeline, 'rabbit', {kind: 'world', environmentId: 'farm'}, 9)).toEqual({kind: 'world', environmentId: 'farm'});
    expect(resolveOwner(timeline, 'rabbit', {kind: 'world', environmentId: 'farm'}, 10)).toEqual({kind: 'entity', entityId: 'farmer', slot: 'rightHand'});
    expect(resolveOwner(timeline, 'rabbit', {kind: 'world', environmentId: 'farm'}, 90)).toEqual({kind: 'world', environmentId: 'farm'});
  });
});

describe('FrameEvaluator golden determinism', () => {
  const goldenFrames = new Map<number, unknown>([
    [0, frame0],
    [30, frame30],
    [60, frame60],
    [90, frame90],
  ]);

  for (const [frame, golden] of goldenFrames) {
    it(`matches the frame ${frame} golden JSON`, () => {
      expect(evaluateFrame(demoRenderPlan, frame)).toEqual(golden);
    });
  }

  it('returns byte-equivalent JSON across 100 independent evaluations', () => {
    const expected = JSON.stringify(evaluateFrame(demoRenderPlan, 60));
    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(JSON.stringify(evaluateFrame(demoRenderPlan, 60))).toBe(expected);
    }
  });
});
