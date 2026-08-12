import type {ExpandedAction} from '@pose-clip/schemas';
import type {SolvedActionTiming} from './types.js';

export function allocateRequiredActions(
  actions: readonly ExpandedAction[],
  startFrame: number,
): {timings: SolvedActionTiming[]; durationFrames: number} {
  const timings: SolvedActionTiming[] = [];
  let cursor = startFrame;
  for (const action of actions.filter(candidate => candidate.priority === 'required').sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))) {
    timings.push({expandedActionId: action.id, startFrame: cursor, endFrame: cursor + action.minDurationFrames});
    cursor += action.minDurationFrames;
  }
  return {timings, durationFrames: cursor - startFrame};
}
