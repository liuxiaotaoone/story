import type {EntityInstance, Point, PoseClipFrame, Size} from '@pose-clip/schemas';
import type {PoseSelection} from './pose-transition.js';
import type {PreparedRenderPlan} from '../prepared/prepare-render-plan.js';
import {resolvePoseClipFrame} from './pose-clip-evaluator.js';
import {projectGround} from '../spatial/ground-projection.js';
import {resolveEntityTrack} from '../timeline/track-resolver.js';
import {resolveShot} from '../timeline/shot-resolver.js';

export interface GroundLockSegment {
  startFrame: number;
  endFrame: number;
}

export interface GroundLockResult {
  anchor: Point;
  locked: boolean;
  referenceFoot: 'left-foot' | 'right-foot' | 'midpoint' | 'foot';
  segment?: GroundLockSegment;
  lockedWorldPoint?: Point;
  correction: Point;
  correctionPx: number;
}

function midpoint(left: Point, right: Point): Point {
  return {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2};
}

function reference(frame: PoseClipFrame): {name: GroundLockResult['referenceFoot']; anchor: Point} {
  const requested = frame.referenceFoot ?? 'auto';
  if (requested === 'left-foot' && frame.anchors.leftFoot !== undefined) return {name: requested, anchor: frame.anchors.leftFoot};
  if (requested === 'right-foot' && frame.anchors.rightFoot !== undefined) return {name: requested, anchor: frame.anchors.rightFoot};
  if (requested === 'midpoint' && frame.anchors.leftFoot !== undefined && frame.anchors.rightFoot !== undefined) {
    return {name: 'midpoint', anchor: midpoint(frame.anchors.leftFoot, frame.anchors.rightFoot)};
  }
  const contact = frame.contact?.type ?? 'none';
  if (contact === 'left-foot' && frame.anchors.leftFoot !== undefined) return {name: 'left-foot', anchor: frame.anchors.leftFoot};
  if (contact === 'right-foot' && frame.anchors.rightFoot !== undefined) return {name: 'right-foot', anchor: frame.anchors.rightFoot};
  if (contact === 'both' && frame.anchors.leftFoot !== undefined && frame.anchors.rightFoot !== undefined) {
    return {name: 'midpoint', anchor: midpoint(frame.anchors.leftFoot, frame.anchors.rightFoot)};
  }
  return {name: 'foot', anchor: frame.anchors.foot};
}

function contactKey(frame: PoseClipFrame): string | undefined {
  if ((frame.contact?.type ?? 'none') === 'none') return undefined;
  return reference(frame).name;
}

function worldPositionAt(prepared: PreparedRenderPlan, instance: EntityInstance, frame: number): Point {
  const shot = resolveShot(prepared.plan.timeline, frame);
  const environment = prepared.environmentById.get(shot.environmentId);
  if (environment === undefined) throw new Error(`Missing environment ${shot.environmentId}`);
  const track = resolveEntityTrack(prepared.entityTrackByEntityId.get(instance.id), frame);
  if (track.groundPosition !== undefined) return projectGround(environment, track.groundPosition).worldFootPosition;
  return track.worldPosition ?? projectGround(environment, {u: 0.5, v: 0.5}).worldFootPosition;
}

export function resolveGroundLock(
  prepared: PreparedRenderPlan,
  instance: EntityInstance,
  selection: PoseSelection,
  absoluteFrame: number,
  _assetSize: Size,
  _scale: Point,
): GroundLockResult {
  const clip = prepared.poseClipById.get(selection.poseClipId);
  if (clip === undefined) throw new Error(`Missing PoseClip ${selection.poseClipId}`);
  const resolved = resolvePoseClipFrame(clip, absoluteFrame, selection.startFrame, selection.playbackRate, selection.clipStartOffset);
  const selected = reference(resolved.frame);
  const unlocked = (): GroundLockResult => ({
    anchor: resolved.frame.anchors.foot,
    locked: false,
    referenceFoot: 'foot',
    correction: {x: 0, y: 0},
    correctionPx: 0,
  });
  if (clip.groundLock.mode === 'none') return unlocked();
  if (clip.groundLock.mode === 'contact-only' && contactKey(resolved.frame) === undefined) return unlocked();
  if (clip.groundLock.mode === 'always') {
    return {
      anchor: selected.anchor,
      locked: true,
      referenceFoot: selected.name,
      segment: {startFrame: absoluteFrame, endFrame: absoluteFrame + 1},
      lockedWorldPoint: worldPositionAt(prepared, instance, absoluteFrame),
      correction: {x: 0, y: 0},
      correctionPx: 0,
    };
  }

  const key = contactKey(resolved.frame);
  if (key === undefined) return unlocked();
  const timeline = prepared.plan.timeline;
  const currentShot = resolveShot(timeline, absoluteFrame);
  let startFrame = absoluteFrame;
  while (startFrame > Math.max(0, selection.startFrame)) {
    const candidate = startFrame - 1;
    const candidateShot = resolveShot(timeline, candidate);
    if (candidateShot.id !== currentShot.id) break;
    const candidateFrame = resolvePoseClipFrame(clip, candidate, selection.startFrame, selection.playbackRate, selection.clipStartOffset).frame;
    if (contactKey(candidateFrame) !== key) break;
    startFrame = candidate;
  }
  let endFrame = absoluteFrame + 1;
  while (endFrame < timeline.durationFrames) {
    const candidateShot = resolveShot(timeline, endFrame);
    if (candidateShot.id !== currentShot.id) break;
    const candidateFrame = resolvePoseClipFrame(clip, endFrame, selection.startFrame, selection.playbackRate, selection.clipStartOffset).frame;
    if (contactKey(candidateFrame) !== key) break;
    endFrame += 1;
  }

  const lockedWorldPoint = worldPositionAt(prepared, instance, startFrame);
  const currentWorldPoint = worldPositionAt(prepared, instance, absoluteFrame);
  const correction = {
    x: lockedWorldPoint.x - currentWorldPoint.x,
    y: lockedWorldPoint.y - currentWorldPoint.y,
  };
  const correctionPx = Math.hypot(correction.x, correction.y);
  if (correctionPx > clip.groundLock.maxCorrectionPx + 1e-6) {
    throw new Error(`Ground lock correction ${correctionPx.toFixed(3)}px exceeds ${clip.groundLock.maxCorrectionPx}px for ${clip.id}`);
  }
  return {
    anchor: selected.anchor,
    locked: true,
    referenceFoot: selected.name,
    segment: {startFrame, endFrame},
    lockedWorldPoint,
    correction,
    correctionPx,
  };
}
