import {describe, expect, it} from 'vitest';
import {createAssetGateRenderPlan} from '../src/demo-render-plan.js';

Object.defineProperty(globalThis, 'location', {
  value: new URL('http://127.0.0.1:4174/demo.html'),
  configurable: true,
});

describe('M1 v0.2.1 staging contract', () => {
  it('keeps the farmer at one world ground position for the complete shot', () => {
    const plan = createAssetGateRenderPlan();
    const track = plan.timeline.entityTracks.find(candidate => candidate.entityId === 'farmer');
    expect(track?.groundPosition).toEqual([
      {frame: 0, value: {u: 0.21, v: 0.58}, easing: 'hold'},
      {frame: 299, value: {u: 0.21, v: 0.58}, easing: 'hold'},
    ]);
  });

  it('uses camera pan plus a cut, not static-pose locomotion or crossfade', () => {
    const plan = createAssetGateRenderPlan();
    const camera = plan.timeline.cameraTracks[0];
    const transition = plan.timeline.poseTransitions.find(candidate => candidate.entityId === 'farmer');
    expect(camera?.position.map(keyframe => keyframe.value)).toContainEqual({x: 610, y: 360});
    expect(transition).toMatchObject({startFrame: 210, durationFrames: 0, mode: 'cut'});
  });
});
