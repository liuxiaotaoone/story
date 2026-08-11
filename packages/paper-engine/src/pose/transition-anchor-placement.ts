import type {Point, PoseTransition, Size} from '@pose-clip/schemas';
import {worldPointForLocalAnchor} from './anchor-placement.js';

export interface TransitionAnchorCandidate {
  role: 'from' | 'to';
  weight: number;
  spriteWorldAnchor: Point;
  spriteLocalAnchor: Point;
  policyLocalAnchor: Point;
  assetSize: Size;
  scale: Point;
  rotation: number;
}

export interface TransitionAnchorPlacement {
  role: 'from' | 'to';
  position: Point;
  anchor: Point;
}

export interface ResolvedTransitionAnchorPlacement {
  policy: PoseTransition['anchorPolicy'];
  commonWorldPoint: Point;
  placements: TransitionAnchorPlacement[];
}

export function resolveTransitionAnchorPlacement(
  policy: PoseTransition['anchorPolicy'],
  candidates: readonly TransitionAnchorCandidate[],
): ResolvedTransitionAnchorPlacement {
  if (candidates.length !== 2 || new Set(candidates.map(({role}) => role)).size !== 2) {
    throw new Error('Transition anchor placement requires exactly one from and one to candidate');
  }
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (totalWeight <= 0) throw new Error('Transition anchor placement requires positive total weight');
  const weightedWorldPoints = candidates.map((candidate) => ({
    candidate,
    weight: candidate.weight / totalWeight,
    worldPoint: worldPointForLocalAnchor(
      candidate.spriteWorldAnchor,
      candidate.spriteLocalAnchor,
      candidate.policyLocalAnchor,
      candidate.assetSize,
      candidate.scale,
      candidate.rotation,
    ),
  }));
  const commonWorldPoint = {
    x: weightedWorldPoints.reduce((sum, item) => sum + item.worldPoint.x * item.weight, 0),
    y: weightedWorldPoints.reduce((sum, item) => sum + item.worldPoint.y * item.weight, 0),
  };
  return {
    policy,
    commonWorldPoint,
    placements: candidates.map((candidate) => ({
      role: candidate.role,
      position: commonWorldPoint,
      anchor: candidate.policyLocalAnchor,
    })),
  };
}
