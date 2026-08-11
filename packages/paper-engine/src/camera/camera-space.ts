import type {CameraState, Point, SpriteRenderState} from '@pose-clip/schemas';

export function resolveCameraSpacePoint(
  point: Point,
  camera: CameraState,
  cameraSpace: SpriteRenderState['cameraSpace'],
): Point {
  if (cameraSpace.kind === 'screen') return {...point};
  const translated = {
    x: (point.x - camera.position.x * cameraSpace.influence) * camera.zoom,
    y: (point.y - camera.position.y * cameraSpace.influence) * camera.zoom,
  };
  const cosine = Math.cos(-camera.rotation);
  const sine = Math.sin(-camera.rotation);
  return {
    x: translated.x * cosine - translated.y * sine,
    y: translated.x * sine + translated.y * cosine,
  };
}
