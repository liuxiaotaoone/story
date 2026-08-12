import type {BlockingIntent, GroundPoint} from '@pose-clip/schemas';

const HORIZONTAL: Record<BlockingIntent['horizontal'], number> = {
  'far-left': 0.1,
  left: 0.28,
  center: 0.5,
  right: 0.72,
  'far-right': 0.9,
};

const DEPTH: Record<BlockingIntent['depth'], number> = {
  background: 0.15,
  midground: 0.4,
  ground: 0.65,
  foreground: 0.88,
};

export function compileBlockingIntent(blocking: BlockingIntent): GroundPoint {
  return {u: HORIZONTAL[blocking.horizontal], v: DEPTH[blocking.depth]};
}
