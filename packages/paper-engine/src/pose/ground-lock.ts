import type {Point, PoseClip, PoseClipFrame, Size} from '@pose-clip/schemas';

export interface GroundLockResolution {
  anchor: Point;
  correctionPx: number;
  locked: boolean;
}

function midpoint(left: Point, right: Point): Point {
  return {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2};
}

function referenceAnchor(frame: PoseClipFrame): Point | undefined {
  const reference = frame.referenceFoot ?? 'auto';
  if (reference === 'left-foot') return frame.anchors.leftFoot;
  if (reference === 'right-foot') return frame.anchors.rightFoot;
  if (reference === 'midpoint') {
    return frame.anchors.leftFoot !== undefined && frame.anchors.rightFoot !== undefined
      ? midpoint(frame.anchors.leftFoot, frame.anchors.rightFoot)
      : undefined;
  }
  const contact = frame.contact?.type ?? 'none';
  if (contact === 'left-foot') return frame.anchors.leftFoot;
  if (contact === 'right-foot') return frame.anchors.rightFoot;
  if (contact === 'both') {
    return frame.anchors.leftFoot !== undefined && frame.anchors.rightFoot !== undefined
      ? midpoint(frame.anchors.leftFoot, frame.anchors.rightFoot)
      : undefined;
  }
  return frame.anchors.foot;
}

export function resolveGroundLockAnchor(
  clip: PoseClip,
  frame: PoseClipFrame,
  assetSize: Size,
  scale: Point,
): GroundLockResolution {
  const contact = frame.contact?.type ?? 'none';
  const shouldLock = clip.groundLock.mode === 'always'
    || (clip.groundLock.mode === 'contact-only' && contact !== 'none');
  if (!shouldLock) return {anchor: frame.anchors.foot, correctionPx: 0, locked: false};
  const selected = referenceAnchor(frame) ?? frame.anchors.foot;
  const correctionX = (selected.x - frame.anchors.foot.x) * assetSize.width * scale.x;
  const correctionY = (selected.y - frame.anchors.foot.y) * assetSize.height * scale.y;
  const correctionPx = Math.hypot(correctionX, correctionY);
  if (correctionPx > clip.groundLock.maxCorrectionPx) {
    throw new Error(`Ground lock correction ${correctionPx.toFixed(3)}px exceeds ${clip.groundLock.maxCorrectionPx}px for ${clip.id}`);
  }
  return {anchor: selected, correctionPx, locked: true};
}
