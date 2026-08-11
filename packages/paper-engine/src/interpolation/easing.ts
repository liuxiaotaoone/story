import type {Easing} from '@pose-clip/schemas';
import {clamp} from './lerp.js';

export type {Easing};

export function applyEasing(easing: Easing, progress: number): number {
  const t = clamp(progress, 0, 1);
  switch (easing) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    case 'hold': return 0;
  }
  throw new Error(`Unsupported easing: ${String(easing)}`);
}
