import type {DurationPreference} from '@pose-clip/schemas';
import {secondsToFramesCeil, secondsToFramesFloor, secondsToFramesRound} from './frame-math.js';

export interface ShotDurationResolution {
  durationFrames?: number;
  minimumFrames: number;
  preferredFrames?: number;
  maxFrames?: number;
  expandedForContent: boolean;
  unsatisfiable: boolean;
}

export function resolveShotDuration(input: {
  narrationFrames: number;
  actionFrames: number;
  cameraFrames: number;
  preference?: DurationPreference;
  fps: number;
}): ShotDurationResolution {
  const directorMinimum = input.preference?.minSeconds === undefined ? 0 : secondsToFramesCeil(input.preference.minSeconds, input.fps);
  const minimumFrames = Math.max(input.narrationFrames, input.actionFrames, input.cameraFrames, directorMinimum);
  const preferredFrames = input.preference?.preferredSeconds === undefined ? undefined : secondsToFramesRound(input.preference.preferredSeconds, input.fps);
  const maxFrames = input.preference?.maxSeconds === undefined ? undefined : secondsToFramesFloor(input.preference.maxSeconds, input.fps);
  if (maxFrames !== undefined && minimumFrames > maxFrames) {
    return {
      minimumFrames, maxFrames, expandedForContent: false, unsatisfiable: true,
      ...(preferredFrames === undefined ? {} : {preferredFrames}),
    };
  }
  const durationFrames = Math.max(minimumFrames, preferredFrames ?? 0);
  return {
    durationFrames,
    minimumFrames,
    ...(preferredFrames === undefined ? {} : {preferredFrames}),
    ...(maxFrames === undefined ? {} : {maxFrames}),
    expandedForContent: preferredFrames !== undefined && preferredFrames < minimumFrames,
    unsatisfiable: false,
  };
}
