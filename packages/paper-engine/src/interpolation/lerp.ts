import type {Point} from '@pose-clip/schemas';

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function lerpPoint(start: Point, end: Point, amount: number): Point {
  return {
    x: lerp(start.x, end.x, amount),
    y: lerp(start.y, end.y, amount),
  };
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
