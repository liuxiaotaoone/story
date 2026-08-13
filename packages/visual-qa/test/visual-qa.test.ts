import {describe, expect, it} from 'vitest';
import type {RenderPlan} from '@pose-clip/schemas';
import {collectMeaningfulVisualEvents, evaluateMeaningfulMotion, evaluateVisualCadence, grayscaleMeanAbsoluteDifference, packedGrayscaleDifferences} from '../src/index.js';

describe('production visual QA', () => {
  it('fails low meaningful motion longer than two seconds at 30 FPS', () => {
    expect(evaluateMeaningfulMotion(Array(60).fill(0.1)).failures).toHaveLength(0);
    expect(evaluateMeaningfulMotion(Array(61).fill(0.1)).failures).toHaveLength(1);
  });

  it('evaluates decoded grayscale frames and meaningful cadence', () => {
    expect(grayscaleMeanAbsoluteDifference(Uint8Array.from([0, 2]), Uint8Array.from([2, 4]))).toBe(2);
    expect(packedGrayscaleDifferences(Uint8Array.from([0, 0, 1, 1, 4, 4]), 2)).toEqual({frameCount: 3, differences: [1, 3]});
    expect(evaluateVisualCadence([{frame: 120, type: 'pose-change', sourceId: 'pose'}], 241).pass).toBe(true);
    expect(evaluateVisualCadence([], 241).pass).toBe(false);
  });

  it('does not invent continuous motion events inside a hold interval', () => {
    const planWith = (easing: 'hold' | 'linear') => ({timeline: {
      shots: [], poseEvents: [], visibilityEvents: [], ownershipEvents: [], effectEvents: [], cameraTracks: [],
      entityTracks: [{entityId: 'rabbit', groundPosition: [
        {frame: 0, value: {u: 0.2, v: 0.6}, easing},
        {frame: 300, value: {u: 0.8, v: 0.6}, easing: 'hold'},
      ]}],
    }}) as unknown as RenderPlan;
    const held = collectMeaningfulVisualEvents(planWith('hold'));
    const moving = collectMeaningfulVisualEvents(planWith('linear'));
    expect(held.map(event => event.frame)).toEqual([300]);
    expect(evaluateVisualCadence(held, 301).pass).toBe(false);
    expect(moving.map(event => event.frame)).toEqual([0, 120, 240, 300]);
    expect(evaluateVisualCadence(moving, 301).pass).toBe(true);
  });
});
