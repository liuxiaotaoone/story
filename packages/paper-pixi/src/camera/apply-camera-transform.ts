import type {CameraState, SpriteRenderState} from '@pose-clip/schemas';
import {CANONICAL_RENDER_SIZE, resolveCameraSpaceTransform} from '@pose-clip/paper-engine';

export function resolveSpriteForPixi(sprite: SpriteRenderState, camera: CameraState) {
  return resolveCameraSpaceTransform({
    transform: sprite.transform,
    camera,
    cameraSpace: sprite.cameraSpace,
    viewport: CANONICAL_RENDER_SIZE,
  });
}
