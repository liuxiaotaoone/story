import {
  EffectiveDirectorPlanSchema,
  CapabilityCatalogSchema,
  MeasuredAudioSchema,
  PreflightCompileResultSchema,
  type CapabilityCatalog,
  type EffectiveDirectorPlan,
  type MeasuredAudio,
  type PreflightCompileResult,
} from '@pose-clip/schemas';
import {allocateRequiredActions} from './action-allocation.js';
import {allocateNarration} from './narration-allocation.js';
import {resolveShotDuration} from './shot-duration.js';
import type {DurationSolveResult, SolvedShotTiming} from './types.js';

export function solveDurations(input: {
  effectiveDirectorPlan: EffectiveDirectorPlan;
  preflight: PreflightCompileResult;
  measuredAudio: readonly MeasuredAudio[];
  capabilityCatalog: CapabilityCatalog;
  fps: number;
}): DurationSolveResult {
  const effective = EffectiveDirectorPlanSchema.parse(input.effectiveDirectorPlan);
  const preflight = PreflightCompileResultSchema.parse(input.preflight);
  const catalog = CapabilityCatalogSchema.parse(input.capabilityCatalog);
  const measuredAudio = input.measuredAudio.map(audio => MeasuredAudioSchema.parse(audio));
  if (!Number.isInteger(input.fps) || input.fps <= 0) throw new RangeError('fps must be a positive integer');
  const plan = effective.plan;
  const cameraMinimums = new Map(catalog.cameraCapabilities.map(capability => [capability.intent, capability.minDurationFrames]));
  const diagnostics = [];
  const shots: SolvedShotTiming[] = [];
  let shotStartFrame = 0;

  for (const shot of plan.shots) {
    const segments = preflight.narrationSegments.filter(segment => segment.shotId === shot.id);
    const narration = allocateNarration({
      segments, ttsRequests: preflight.ttsRequests, measuredAudio,
      fps: input.fps, startFrame: shotStartFrame,
    });
    const actions = allocateRequiredActions(
      preflight.expandedActions.filter(action => action.shotId === shot.id),
      shotStartFrame,
    );
    const cameraIntent = plan.cameraIntents.find(intent => intent.shotId === shot.id)!;
    const duration = resolveShotDuration({
      narrationFrames: narration.durationFrames,
      actionFrames: actions.durationFrames,
      cameraFrames: cameraMinimums.get(cameraIntent.type) ?? 0,
      ...(shot.durationPreference === undefined ? {} : {preference: shot.durationPreference}),
      fps: input.fps,
    });
    if (duration.unsatisfiable) {
      diagnostics.push({
        id: `diagnostic.${shot.id}.duration`, severity: 'error' as const, code: 'DURATION_UNSATISFIABLE' as const,
        message: `Shot ${shot.id} requires ${duration.minimumFrames} frames but max is ${duration.maxFrames}`,
        sourceId: shot.id, path: `/shots/${shot.id}/durationPreference`, recoverable: false,
      });
      continue;
    }
    if (duration.expandedForContent) {
      diagnostics.push({
        id: `diagnostic.${shot.id}.expanded`, severity: 'warning' as const, code: 'SHOT_EXPANDED_FOR_CONTENT' as const,
        message: `Shot ${shot.id} expanded from preferred ${duration.preferredFrames} to ${duration.durationFrames} frames`,
        sourceId: shot.id, path: `/shots/${shot.id}/durationPreference`, recoverable: true,
      });
    }
    const shotEndFrame = shotStartFrame + duration.durationFrames!;
    shots.push({
      shotId: shot.id, startFrame: shotStartFrame, endFrame: shotEndFrame,
      narration: narration.timings, actions: actions.timings,
    });
    shotStartFrame = shotEndFrame;
  }

  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) return {ok: false, diagnostics};
  return {ok: true, timing: {fps: input.fps, durationFrames: shotStartFrame, shots, diagnostics}};
}
