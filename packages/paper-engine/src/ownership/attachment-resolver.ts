import type {Point, SocketBinding} from '@pose-clip/schemas';

export interface AttachmentTransformInput {
  ownerAnchorWorld: Point;
  ownerRotation: number;
  ownerScale: Point;
  childBaseScale: Point;
  binding: SocketBinding;
}

export interface AttachmentTransformResult {
  position: Point;
  rotation: number;
  scale: Point;
}

export function resolveSocketAttachment(input: AttachmentTransformInput): AttachmentTransformResult {
  const scaleMultiplier = input.binding.scaleMultiplier ?? 1;
  return {
    position: input.ownerAnchorWorld,
    rotation: (input.binding.inheritRotation ? input.ownerRotation : 0) + (input.binding.rotationOffset ?? 0),
    scale: {
      x: input.childBaseScale.x * scaleMultiplier * (input.binding.inheritScale ? input.ownerScale.x : 1),
      y: input.childBaseScale.y * scaleMultiplier * (input.binding.inheritScale ? input.ownerScale.y : 1),
    },
  };
}
