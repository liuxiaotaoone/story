import {describe, expect, it} from 'vitest';
import {evaluateCameraSafeBounds, evaluateCharacterScale, evaluateCoverage, evaluateStoryActions, evaluateVisualEventCadence, scanFreezeRuns} from '../src/quality-gates.mjs';

describe('M2.1 visual quality gates', () => {
  it('requires both whole-frame and border coverage', () => {
    expect(evaluateCoverage({totalPixelCount: 1000, validPixelCount: 999, edgePixelCount: 100, edgeValidPixelCount: 100}).pass).toBe(true);
    expect(evaluateCoverage({totalPixelCount: 1000, validPixelCount: 999, edgePixelCount: 100, edgeValidPixelCount: 90}).pass).toBe(false);
  });

  it('warns above one second and fails above two seconds at 30 FPS', () => {
    expect(scanFreezeRuns(Array(31).fill('same')).warnings).toHaveLength(1);
    expect(scanFreezeRuns(Array(31).fill('same')).failures).toHaveLength(0);
    expect(scanFreezeRuns(Array(61).fill('same')).failures).toHaveLength(1);
  });

  it('requires a visual event at least every four seconds', () => {
    expect(evaluateVisualEventCadence([60, 180], 240).pass).toBe(true);
    expect(evaluateVisualEventCadence([121], 300).pass).toBe(false);
  });

  it('requires every narrated story action and the stump landmark', () => {
    const renderPlan = {
      timeline: {poseEvents: [
        {poseClipId: 'rabbit.run-left'},
        {poseClipId: 'rabbit.collision'},
      ]},
      instances: [{id: 'stump'}],
    };
    expect(evaluateStoryActions(renderPlan, ['rabbit.run-left', 'rabbit.collision']).pass).toBe(true);
    expect(evaluateStoryActions(renderPlan, ['rabbit.run-left', 'rabbit.lying'])).toMatchObject({
      pass: false,
      missing: ['rabbit.lying'],
      stumpPresent: true,
    });
    expect(evaluateStoryActions({...renderPlan, instances: []}, ['rabbit.run-left']).pass).toBe(false);
  });

  it('rejects camera keyframes outside the declared safe bounds', () => {
    const renderPlan = {timeline: {cameraTracks: [{shotId: 'shot-1', position: [
      {frame: 0, value: {x: 640, y: 360}},
      {frame: 30, value: {x: 901, y: 360}},
    ]}]}};
    const result = evaluateCameraSafeBounds(renderPlan, {minX: 440, maxX: 900, minY: 340, maxY: 380});
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([{shotId: 'shot-1', frame: 30, position: {x: 901, y: 360}}]);
  });

  it('enforces the rabbit-to-farmer canonical height ratio', () => {
    const plan = {assets: {assets: [
      {id: 'farmer-idle', height: 315},
      {id: 'rabbit-run-1', height: 112},
    ]}};
    expect(evaluateCharacterScale(plan)).toMatchObject({pass: true});
    plan.assets.assets[1].height = 160;
    expect(evaluateCharacterScale(plan)).toMatchObject({pass: false});
  });
});
