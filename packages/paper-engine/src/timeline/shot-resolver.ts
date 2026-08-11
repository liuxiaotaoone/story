import type {Timeline} from '@pose-clip/schemas';
import {assertFrameInTimeline, containsFrame} from './frame-range.js';

export type Shot = Timeline['shots'][number];

export function resolveShot(timeline: Timeline, frame: number): Shot {
  assertFrameInTimeline(frame, timeline.durationFrames);
  const shot = timeline.shots.find((candidate) => containsFrame(candidate.range, frame));
  if (shot === undefined) throw new Error(`Timeline has no shot at frame ${frame}`);
  return shot;
}
