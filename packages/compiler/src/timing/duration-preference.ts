import type {DurationPreference} from '@pose-clip/schemas';
import {secondsToFramesCeil, secondsToFramesFloor, secondsToFramesRound} from './frame-math.js';

export interface DurationPreferenceResolution {
  minimumFrames: number;
  durationFrames?: number;
  preferredFrames?: number;
  maxFrames?: number;
  expandedForContent: boolean;
  unsatisfiable: boolean;
}

export function resolveDurationPreference(input: {
  contentMinimumFrames: number;
  absoluteMinimumFrames: number;
  preference?: DurationPreference;
  fps: number;
}): DurationPreferenceResolution {
  const directorMinimum = input.preference?.minSeconds === undefined ? 0 : secondsToFramesCeil(input.preference.minSeconds, input.fps);
  const minimumFrames = Math.max(input.absoluteMinimumFrames, input.contentMinimumFrames, directorMinimum);
  const maxFrames = input.preference?.maxSeconds === undefined ? undefined : secondsToFramesFloor(input.preference.maxSeconds, input.fps);
  const rawPreferredFrames = input.preference?.preferredSeconds === undefined ? undefined : secondsToFramesRound(input.preference.preferredSeconds, input.fps);
  const preferredFrames = rawPreferredFrames === undefined
    ? undefined
    : maxFrames === undefined
      ? rawPreferredFrames
      : Math.min(rawPreferredFrames, maxFrames);
  if (maxFrames !== undefined && minimumFrames > maxFrames) {
    return {
      minimumFrames, maxFrames, expandedForContent: false, unsatisfiable: true,
      ...(preferredFrames === undefined ? {} : {preferredFrames}),
    };
  }
  const durationFrames = Math.max(minimumFrames, preferredFrames ?? 0);
  return {
    minimumFrames, durationFrames,
    ...(preferredFrames === undefined ? {} : {preferredFrames}),
    ...(maxFrames === undefined ? {} : {maxFrames}),
    expandedForContent: preferredFrames !== undefined && preferredFrames < minimumFrames,
    unsatisfiable: false,
  };
}
