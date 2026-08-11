import type {CameraState, Point, Size, SpriteRenderState, Transform2D} from '@pose-clip/schemas';

export interface CameraSpaceTransformInput {
  transform: Transform2D;
  camera: CameraState;
  cameraSpace: SpriteRenderState['cameraSpace'];
  viewport: Size;
}

/**
 * Frozen v0.1 contract:
 * - camera.position is the world point shown at viewport center for influence=1.
 * - camera translation is multiplied by parallax influence.
 * - world transforms rotate by -camera.rotation around viewport center, then zoom.
 * - world scale is multiplied by zoom and rotation subtracts camera rotation.
 * - screen-space transforms are returned unchanged.
 */
export function resolveCameraSpaceTransform(input: CameraSpaceTransformInput): Transform2D {
  const {transform, camera, cameraSpace, viewport} = input;
  if (cameraSpace.kind === 'screen') {
    return {
      position: {...transform.position},
      scale: {...transform.scale},
      rotation: transform.rotation,
      opacity: transform.opacity,
    };
  }
  const center = {x: viewport.width / 2, y: viewport.height / 2};
  const translated = {
    x: transform.position.x + (center.x - camera.position.x) * cameraSpace.influence,
    y: transform.position.y + (center.y - camera.position.y) * cameraSpace.influence,
  };
  const relative = {x: translated.x - center.x, y: translated.y - center.y};
  const cosine = Math.cos(-camera.rotation);
  const sine = Math.sin(-camera.rotation);
  const rotated = {
    x: relative.x * cosine - relative.y * sine,
    y: relative.x * sine + relative.y * cosine,
  };
  return {
    position: {
      x: center.x + rotated.x * camera.zoom,
      y: center.y + rotated.y * camera.zoom,
    },
    scale: {
      x: transform.scale.x * camera.zoom,
      y: transform.scale.y * camera.zoom,
    },
    rotation: transform.rotation - camera.rotation,
    opacity: transform.opacity,
  };
}

export function resolveCameraSpacePoint(
  point: Point,
  camera: CameraState,
  cameraSpace: SpriteRenderState['cameraSpace'],
  viewport: Size = {width: 1280, height: 720},
): Point {
  return resolveCameraSpaceTransform({
    transform: {position: point, scale: {x: 1, y: 1}, rotation: 0, opacity: 1},
    camera,
    cameraSpace,
    viewport,
  }).position;
}
