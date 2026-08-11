import type {PoseClip, PoseClipFrame} from '@pose-clip/schemas';

export interface ResolvedPoseClipFrame {
  frame: PoseClipFrame;
  frameIndex: number;
  clipFrame: number;
  frameStart: number;
}

export function poseClipDuration(clip: PoseClip): number {
  return clip.frames.reduce((total, frame) => total + frame.durationFrames, 0);
}

export function resolvePoseClipFrame(
  clip: PoseClip,
  frame: number,
  startFrame: number,
  playbackRate = 1,
  clipStartOffset = 0,
): ResolvedPoseClipFrame {
  if (playbackRate <= 0 || !Number.isFinite(playbackRate)) throw new RangeError('playbackRate must be positive');
  const duration = poseClipDuration(clip);
  if (duration <= 0) throw new Error(`PoseClip ${clip.id} has no duration`);
  const elapsed = Math.max(0, frame - startFrame);
  const rawClipFrame = Math.floor(elapsed * playbackRate) + clipStartOffset;
  const clipFrame = clip.loop
    ? ((rawClipFrame % duration) + duration) % duration
    : Math.min(duration - 1, Math.max(0, rawClipFrame));

  let cursor = 0;
  for (const [frameIndex, poseFrame] of clip.frames.entries()) {
    const end = cursor + poseFrame.durationFrames;
    if (clipFrame < end) return {frame: poseFrame, frameIndex, clipFrame, frameStart: cursor};
    cursor = end;
  }
  throw new Error(`Failed to resolve PoseClip ${clip.id} at clip frame ${clipFrame}`);
}
