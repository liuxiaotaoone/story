import {describe, expect, it} from 'vitest';
import type {EffectiveDirectorPlan, MeasuredAudio, PreflightCompileResult} from '@pose-clip/schemas';
import {compilePreflight, createEffectiveDirectorPlan} from '../src/index.js';
import {solveDurations} from '../src/timing/duration-solver.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';

async function fixture() {
  const effectiveDirectorPlan = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
  const preflight = await compilePreflight({effectiveDirectorPlan, capabilityCatalog});
  return {effectiveDirectorPlan, preflight};
}

function audio(preflight: PreflightCompileResult, sampleFrameCounts: readonly number[]): MeasuredAudio[] {
  return preflight.ttsRequests.map((request, index) => ({
    requestId: request.id,
    sourceTtsRequestHash: request.inputHash,
    assetId: `audio.${request.id}`,
    sampleRate: 48_000,
    sampleFrameCount: sampleFrameCounts[index] ?? sampleFrameCounts.at(-1) ?? 48_000,
    channels: 1,
    contentHash: '0'.repeat(64),
    measurementProducer: {name: 'duration-test', version: '1.0.0'},
  }));
}

function oneShot(
  effective: EffectiveDirectorPlan,
  preflight: PreflightCompileResult,
  options: {
    preferredSeconds?: number;
    maxSeconds?: number;
    actionMinimums?: number[];
    actionPreferences?: Array<{minSeconds?: number; preferredSeconds?: number; maxSeconds?: number}>;
    noActions?: boolean;
  } = {},
) {
  const shot = {
    ...effective.plan.shots[0]!,
    ...((options.preferredSeconds === undefined && options.maxSeconds === undefined)
      ? {durationPreference: undefined}
      : {durationPreference: {
        ...(options.preferredSeconds === undefined ? {} : {preferredSeconds: options.preferredSeconds}),
        ...(options.maxSeconds === undefined ? {} : {maxSeconds: options.maxSeconds}),
      }}),
  };
  const plan = {
    ...effective.plan,
    shots: [shot],
    actions: options.noActions ? [] : [effective.plan.actions[0]!],
    cameraIntents: [effective.plan.cameraIntents[0]!],
    blockingIntents: [effective.plan.blockingIntents[0]!],
  };
  const expanded = options.noActions ? [] : (options.actionMinimums ?? [preflight.expandedActions[0]!.minDurationFrames]).map((minimum, index) => ({
    ...preflight.expandedActions[0]!, id: `expanded.duration-${index}`, sourceActionId: `duration-${index}`, sequence: index, minDurationFrames: minimum,
    ...(options.actionPreferences?.[index] === undefined ? {durationPreference: undefined} : {durationPreference: options.actionPreferences[index]}),
  }));
  return {
    effectiveDirectorPlan: {...effective, plan} as EffectiveDirectorPlan,
    preflight: {...preflight, expandedActions: expanded} as PreflightCompileResult,
  };
}

describe('Duration Solver', () => {
  it('lets narration determine a narration-only shot', async () => {
    const base = await fixture();
    const input = oneShot(base.effectiveDirectorPlan, base.preflight, {noActions: true});
    const result = solveDurations({...input, measuredAudio: audio(input.preflight, [48_000, 24_000]), capabilityCatalog, fps: 30});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timing.shots[0]?.endFrame).toBe(45);
  });

  it('uses the longer of sequential required actions and narration', async () => {
    const base = await fixture();
    const actionLonger = oneShot(base.effectiveDirectorPlan, base.preflight, {actionMinimums: [60, 45]});
    const actionResult = solveDurations({...actionLonger, measuredAudio: audio(actionLonger.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(actionResult.ok && actionResult.timing.shots[0]?.endFrame).toBe(105);

    const narrationLonger = oneShot(base.effectiveDirectorPlan, base.preflight, {actionMinimums: [15]});
    const narrationResult = solveDurations({...narrationLonger, measuredAudio: audio(narrationLonger.preflight, [96_000, 48_000]), capabilityCatalog, fps: 30});
    expect(narrationResult.ok && narrationResult.timing.shots[0]?.endFrame).toBe(90);
  });

  it('uses preferred duration, expands short preference with warning, and rejects hard max', async () => {
    const base = await fixture();
    const preferred = oneShot(base.effectiveDirectorPlan, base.preflight, {preferredSeconds: 5, actionMinimums: [30]});
    const preferredResult = solveDurations({...preferred, measuredAudio: audio(preferred.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(preferredResult.ok && preferredResult.timing.shots[0]?.endFrame).toBe(150);

    const expanded = oneShot(base.effectiveDirectorPlan, base.preflight, {preferredSeconds: 2, actionMinimums: [90]});
    const expandedResult = solveDurations({...expanded, measuredAudio: audio(expanded.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(expandedResult.ok && expandedResult.timing.shots[0]?.endFrame).toBe(90);
    if (expandedResult.ok) expect(expandedResult.timing.diagnostics).toContainEqual(expect.objectContaining({code: 'SHOT_EXPANDED_FOR_CONTENT'}));

    const impossible = oneShot(base.effectiveDirectorPlan, base.preflight, {maxSeconds: 2, actionMinimums: [90]});
    const impossibleResult = solveDurations({...impossible, measuredAudio: audio(impossible.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(impossibleResult).toEqual(expect.objectContaining({ok: false, diagnostics: [expect.objectContaining({code: 'DURATION_UNSATISFIABLE'})]}));
  });

  it('applies each Action duration preference before sequential allocation', async () => {
    const base = await fixture();
    const preferred = oneShot(base.effectiveDirectorPlan, base.preflight, {
      actionMinimums: [30], actionPreferences: [{preferredSeconds: 3, maxSeconds: 4}],
    });
    const preferredResult = solveDurations({...preferred, measuredAudio: audio(preferred.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(preferredResult.ok && preferredResult.timing.shots[0]?.actions[0]).toEqual(expect.objectContaining({startFrame: 0, endFrame: 90}));

    const capabilityWins = oneShot(base.effectiveDirectorPlan, base.preflight, {
      actionMinimums: [60], actionPreferences: [{preferredSeconds: 1}],
    });
    const capabilityResult = solveDurations({...capabilityWins, measuredAudio: audio(capabilityWins.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(capabilityResult.ok && capabilityResult.timing.shots[0]?.actions[0]?.endFrame).toBe(60);

    const actionMinimumWins = oneShot(base.effectiveDirectorPlan, base.preflight, {
      actionMinimums: [30], actionPreferences: [{minSeconds: 2}],
    });
    const actionMinimumResult = solveDurations({...actionMinimumWins, measuredAudio: audio(actionMinimumWins.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(actionMinimumResult.ok && actionMinimumResult.timing.shots[0]?.actions[0]?.endFrame).toBe(60);

    const impossible = oneShot(base.effectiveDirectorPlan, base.preflight, {
      actionMinimums: [90], actionPreferences: [{maxSeconds: 2}],
    });
    const impossibleResult = solveDurations({...impossible, measuredAudio: audio(impossible.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(impossibleResult).toEqual(expect.objectContaining({ok: false, diagnostics: [expect.objectContaining({code: 'DURATION_UNSATISFIABLE'})]}));

    const sequential = oneShot(base.effectiveDirectorPlan, base.preflight, {
      actionMinimums: [30, 15], actionPreferences: [{preferredSeconds: 2}, {preferredSeconds: 1}],
    });
    const sequentialResult = solveDurations({...sequential, measuredAudio: audio(sequential.preflight, [24_000, 24_000]), capabilityCatalog, fps: 30});
    expect(sequentialResult.ok && sequentialResult.timing.shots[0]?.actions).toEqual([
      expect.objectContaining({startFrame: 0, endFrame: 60}),
      expect.objectContaining({startFrame: 60, endFrame: 90}),
    ]);
  });

  it('never lets rounded preferred frames exceed a floored hard max', async () => {
    const base = await fixture();
    const input = oneShot(base.effectiveDirectorPlan, base.preflight, {preferredSeconds: 1.02, maxSeconds: 1.02, noActions: true});
    const result = solveDurations({...input, measuredAudio: audio(input.preflight, [1, 1]), capabilityCatalog, fps: 30});
    expect(result.ok && result.timing.shots[0]?.endFrame).toBe(30);
  });

  it('gives an otherwise empty static shot exactly one frame', async () => {
    const base = await fixture();
    const plan = {
      ...base.effectiveDirectorPlan.plan,
      shots: [{id: 'shot-empty', sceneId: 'scene-field', shotType: 'wide' as const}],
      narration: [], actions: [], blockingIntents: [],
      cameraIntents: [{id: 'camera-empty', sceneId: 'scene-field', shotId: 'shot-empty', type: 'static' as const}],
    };
    const effectiveDirectorPlan = {...base.effectiveDirectorPlan, plan};
    const preflight = {...base.preflight, narrationSegments: [], ttsRequests: [], expandedActions: []};
    const catalog = {...capabilityCatalog, cameraCapabilities: [{intent: 'static' as const, minDurationFrames: 0, allowedShotTypes: ['wide' as const]}]};
    const result = solveDurations({effectiveDirectorPlan, preflight, measuredAudio: [], capabilityCatalog: catalog, fps: 30});
    expect(result.ok && result.timing.shots[0]).toEqual(expect.objectContaining({startFrame: 0, endFrame: 1}));
  });

  it('places consecutive shots without gaps and is identical across 100 runs', async () => {
    const input = await fixture();
    const measuredAudio = audio(input.preflight, [48_000, 24_000]);
    const first = solveDurations({...input, measuredAudio, capabilityCatalog, fps: 30});
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.timing.shots[1]?.startFrame).toBe(first.timing.shots[0]?.endFrame);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(solveDurations({...input, measuredAudio, capabilityCatalog, fps: 30})).toEqual(first);
    }
  });
});
