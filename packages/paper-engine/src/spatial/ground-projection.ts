import type {EnvironmentDefinition, GroundPoint, GroundProjectionResult} from '@pose-clip/schemas';
import {applyEasing} from '../interpolation/easing.js';
import {lerp, lerpPoint} from '../interpolation/lerp.js';

export function projectGround(
  environment: EnvironmentDefinition,
  point: GroundPoint,
): GroundProjectionResult {
  const ground = environment.ground;
  const farPoint = lerpPoint(ground.farLeft, ground.farRight, point.u);
  const nearPoint = lerpPoint(ground.nearLeft, ground.nearRight, point.u);
  const t = applyEasing(ground.depthEasing, point.v);
  const normalized = lerpPoint(farPoint, nearPoint, t);
  return {
    worldFootPosition: {
      x: normalized.x * environment.referenceResolution.width,
      y: normalized.y * environment.referenceResolution.height,
    },
    perspectiveScale: lerp(ground.farScale, ground.nearScale, t),
    depth: point.v,
  };
}
