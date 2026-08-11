import type {FrameRange} from '@pose-clip/schemas';

export function containsFrame(range: FrameRange, frame: number): boolean {
  return frame >= range.startFrame && frame < range.endFrame;
}

export function assertFrameInTimeline(frame: number, durationFrames: number): void {
  if (!Number.isInteger(frame) || frame < 0 || frame >= durationFrames) {
    throw new RangeError(`Frame ${frame} is outside timeline [0, ${durationFrames})`);
  }
}
