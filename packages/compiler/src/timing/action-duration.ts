import type {DurationPreference} from '@pose-clip/schemas';
import {resolveDurationPreference, type DurationPreferenceResolution} from './duration-preference.js';

export function resolveActionDuration(input: {
  capabilityMinimumFrames: number;
  preference?: DurationPreference;
  fps: number;
}): DurationPreferenceResolution {
  return resolveDurationPreference({
    contentMinimumFrames: input.capabilityMinimumFrames,
    absoluteMinimumFrames: 1,
    ...(input.preference === undefined ? {} : {preference: input.preference}),
    fps: input.fps,
  });
}
