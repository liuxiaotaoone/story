import type {Point, Size} from '@pose-clip/schemas';

export function calculateAnchoredTopLeft(
  worldAnchor: Point,
  localAnchor: Point,
  assetSize: Size,
  scale: Point,
): Point {
  return {
    x: worldAnchor.x - localAnchor.x * assetSize.width * scale.x,
    y: worldAnchor.y - localAnchor.y * assetSize.height * scale.y,
  };
}

export function worldPointForLocalAnchor(
  spriteWorldAnchor: Point,
  spriteLocalAnchor: Point,
  targetLocalAnchor: Point,
  assetSize: Size,
  scale: Point,
  rotation: number,
): Point {
  const localX = (targetLocalAnchor.x - spriteLocalAnchor.x) * assetSize.width * scale.x;
  const localY = (targetLocalAnchor.y - spriteLocalAnchor.y) * assetSize.height * scale.y;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: spriteWorldAnchor.x + localX * cosine - localY * sine,
    y: spriteWorldAnchor.y + localX * sine + localY * cosine,
  };
}
