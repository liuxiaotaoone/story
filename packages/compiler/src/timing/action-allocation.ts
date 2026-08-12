import type {CompileDiagnostic, ExpandedAction} from '@pose-clip/schemas';
import {resolveActionDuration} from './action-duration.js';
import type {SolvedActionTiming} from './types.js';

export interface ActionAllocationSuccess {
  ok: true;
  timings: SolvedActionTiming[];
  durationFrames: number;
  diagnostics: CompileDiagnostic[];
}

export interface ActionAllocationFailure {
  ok: false;
  diagnostics: CompileDiagnostic[];
}

export type ActionAllocationResult = ActionAllocationSuccess | ActionAllocationFailure;

export function allocateRequiredActions(
  actions: readonly ExpandedAction[],
  startFrame: number,
  fps: number,
): ActionAllocationResult {
  const timings: SolvedActionTiming[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  let cursor = startFrame;
  for (const action of actions.filter(candidate => candidate.priority === 'required').sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))) {
    const duration = resolveActionDuration({
      capabilityMinimumFrames: action.minDurationFrames,
      ...(action.durationPreference === undefined ? {} : {preference: action.durationPreference}),
      fps,
    });
    if (duration.unsatisfiable) {
      diagnostics.push({
        id: `diagnostic.${action.id}.duration`, severity: 'error', code: 'DURATION_UNSATISFIABLE',
        message: `Action ${action.id} requires ${duration.minimumFrames} frames but max is ${duration.maxFrames}`,
        sourceId: action.sourceActionId, path: `/actions/${action.sourceActionId}/durationPreference`, recoverable: false,
      });
      continue;
    }
    const endFrame = cursor + duration.durationFrames!;
    timings.push({expandedActionId: action.id, startFrame: cursor, endFrame});
    cursor = endFrame;
  }
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) return {ok: false, diagnostics};
  return {ok: true, timings, durationFrames: cursor - startFrame, diagnostics};
}
