import {describe, expect, it} from 'vitest';
import {evaluateMeaningfulMotion, evaluateVisualCadence, grayscaleMeanAbsoluteDifference, packedGrayscaleDifferences} from '../src/index.js';

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
});
