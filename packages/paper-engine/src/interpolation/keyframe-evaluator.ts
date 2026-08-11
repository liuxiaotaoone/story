import {assertStrictFrames, type GroundPoint, type Point} from '@pose-clip/schemas';
import {applyEasing, type Easing} from './easing.js';
import {lerp, lerpPoint} from './lerp.js';

export interface Keyframe<T> {
  frame: number;
  value: T;
  easing: Easing;
}

export function evaluateKeyframes<T>(
  keyframes: readonly Keyframe<T>[],
  frame: number,
  interpolate: (start: T, end: T, amount: number) => T,
): T {
  if (keyframes.length === 0) throw new Error('Cannot evaluate an empty keyframe track');
  assertStrictFrames(keyframes);
  const first = keyframes[0];
  const last = keyframes.at(-1);
  if (first === undefined || last === undefined) throw new Error('Cannot evaluate an empty keyframe track');
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;

  let low = 0;
  let high = keyframes.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = keyframes[middle];
    if (candidate !== undefined && candidate.frame <= frame) low = middle;
    else high = middle;
  }
  const start = keyframes[low];
  const end = keyframes[high];
  if (start === undefined || end === undefined) throw new Error('Failed to resolve keyframe segment');
  if (start.easing === 'hold') return start.value;
  const progress = (frame - start.frame) / (end.frame - start.frame);
  return interpolate(start.value, end.value, applyEasing(start.easing, progress));
}

export function evaluateNumberKeyframes(keyframes: readonly Keyframe<number>[], frame: number): number {
  return evaluateKeyframes(keyframes, frame, lerp);
}

export function evaluatePointKeyframes(keyframes: readonly Keyframe<Point>[], frame: number): Point {
  return evaluateKeyframes(keyframes, frame, lerpPoint);
}

export function evaluateGroundPointKeyframes(keyframes: readonly Keyframe<GroundPoint>[], frame: number): GroundPoint {
  return evaluateKeyframes(keyframes, frame, (start, end, amount) => ({
    u: lerp(start.u, end.u, amount),
    v: lerp(start.v, end.v, amount),
  }));
}
