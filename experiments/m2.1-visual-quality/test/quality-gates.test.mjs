import {describe, expect, it} from 'vitest';
import {collectMeaningfulVisualEvents, evaluateCameraSafeBounds, evaluateCharacterScale, evaluateCoverage, evaluateStoryActions, evaluateVisualEventCadence, grayscaleMeanAbsoluteDifference, packedGrayscaleDifferences, scanMeaningfulMotion} from '../src/quality-gates.mjs';

describe('M2.1 visual quality gates', () => {
  it('requires both whole-frame and border coverage', () => {
    expect(evaluateCoverage({totalPixelCount: 1000, validPixelCount: 999, edgePixelCount: 100, edgeValidPixelCount: 100}).pass).toBe(true);
    expect(evaluateCoverage({totalPixelCount: 1000, validPixelCount: 999, edgePixelCount: 100, edgeValidPixelCount: 90}).pass).toBe(false);
  });

  it('measures perceptual thumbnail change instead of exact frame identity', () => {
    expect(grayscaleMeanAbsoluteDifference(Uint8Array.from([10, 20]), Uint8Array.from([11, 23]))).toBe(2);
    const microMotion = Array(31).fill(0.1);
    expect(scanMeaningfulMotion(microMotion).warnings).toHaveLength(1);
    expect(scanMeaningfulMotion(microMotion).failures).toHaveLength(0);
    expect(scanMeaningfulMotion(Array(61).fill(0.1)).failures).toHaveLength(1);
    expect(scanMeaningfulMotion(Array(90).fill(2)).failures).toHaveLength(0);
  });

  it('derives consecutive differences from decoded packed grayscale video frames', () => {
    expect(packedGrayscaleDifferences(Uint8Array.from([0, 0, 1, 1, 5, 5]), 2)).toEqual({frameCount: 3, differences: [1, 4]});
    expect(() => packedGrayscaleDifferences(Uint8Array.from([0, 1, 2]), 2)).toThrow(/multiple/);
  });

  it('requires a visual event at least every four seconds', () => {
    expect(evaluateVisualEventCadence([60, 180], 240).pass).toBe(true);
    expect(evaluateVisualEventCadence([121], 300).pass).toBe(false);
  });

  it('excludes markers and tiny micro motion from visual cadence', () => {
    const plan = {
      timeline: {
        shots: [{id: 'shot', range: {startFrame: 0, endFrame: 180}}],
        poseEvents: [{id: 'pose', frame: 90}],
        poseTransitions: [], visibilityEvents: [], ownershipEvents: [], effectEvents: [],
        markers: [{id: 'metadata-only', frame: 30}],
        entityTracks: [{entityId: 'farmer', rotation: [{frame: 0, value: -0.004}, {frame: 30, value: 0.004}]}],
        cameraTracks: [{shotId: 'shot', position: [{frame: 0, value: {x: 640, y: 360}}, {frame: 60, value: {x: 650, y: 360}}], zoom: []}],
      },
    };
    const events = collectMeaningfulVisualEvents(plan);
    expect(events.map(event => event.frame)).toEqual([0, 90]);
    expect(events.some(event => event.sourceId === 'metadata-only')).toBe(false);
  });

  it('represents a long continuous camera move without treating metadata as motion', () => {
    const plan = {
      timeline: {
        shots: [{id: 'shot', range: {startFrame: 0, endFrame: 180}}], poseEvents: [], poseTransitions: [],
        visibilityEvents: [], ownershipEvents: [], effectEvents: [], entityTracks: [], markers: [{id: 'marker', frame: 60}],
        cameraTracks: [{shotId: 'shot', position: [], zoom: [{frame: 0, value: 1}, {frame: 150, value: 1.15}]}],
      },
    };
    const events = collectMeaningfulVisualEvents(plan);
    expect(events.filter(event => event.type === 'camera-zoom-change').map(event => event.frame)).toEqual([0, 120, 150]);
    expect(evaluateVisualEventCadence(events.map(event => event.frame), 180).pass).toBe(true);
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
