import type {RenderPlan} from '@pose-clip/schemas';

export interface MeaningfulVisualEvent {frame: number; type: string; sourceId: string}

function sampledChangeFrames<T>(keyframes: readonly {frame: number; value: T}[] | undefined, changed: (left: T, right: T) => boolean, maximumGapFrames: number): number[] {
  const frames: number[] = [];
  for (let index = 1; index < (keyframes?.length ?? 0); index += 1) {
    const previous = keyframes![index - 1]!;
    const current = keyframes![index]!;
    if (!changed(previous.value, current.value)) continue;
    frames.push(previous.frame);
    for (let frame = previous.frame + maximumGapFrames; frame < current.frame; frame += maximumGapFrames) frames.push(frame);
    frames.push(current.frame);
  }
  return frames;
}

export function collectMeaningfulVisualEvents(plan: RenderPlan, maximumGapFrames = 120): MeaningfulVisualEvent[] {
  const events: MeaningfulVisualEvent[] = [];
  const add = (frame: number, type: string, sourceId: string) => events.push({frame, type, sourceId});
  for (const shot of plan.timeline.shots) add(shot.range.startFrame, 'shot-cut', shot.id);
  for (const event of plan.timeline.poseEvents) add(event.frame, 'pose-change', event.id);
  for (const event of plan.timeline.visibilityEvents) add(event.frame, 'visibility', event.id);
  for (const event of plan.timeline.ownershipEvents) add(event.frame, 'ownership', event.id);
  for (const event of plan.timeline.effectEvents) add(event.frame, 'effect', event.id);
  for (const track of plan.timeline.entityTracks) for (const frame of sampledChangeFrames(track.groundPosition, (a, b) => Math.hypot(a.u - b.u, a.v - b.v) >= 0.01, maximumGapFrames)) add(frame, 'entity-movement', track.entityId);
  for (const track of plan.timeline.cameraTracks) {
    for (const frame of sampledChangeFrames(track.position, (a, b) => Math.hypot(a.x - b.x, a.y - b.y) >= 24, maximumGapFrames)) add(frame, 'camera-position', track.shotId);
    for (const frame of sampledChangeFrames(track.zoom, (a, b) => Math.abs(a - b) >= 0.03, maximumGapFrames)) add(frame, 'camera-zoom', track.shotId);
  }
  return events.sort((left, right) => left.frame - right.frame || left.type.localeCompare(right.type) || left.sourceId.localeCompare(right.sourceId));
}

export function evaluateVisualCadence(events: readonly MeaningfulVisualEvent[], durationFrames: number, maximumGapFrames = 120) {
  const frames = [...new Set([0, durationFrames - 1, ...events.map(event => event.frame)])].sort((a, b) => a - b);
  const gaps = frames.slice(1).map((frame, index) => ({startFrame: frames[index]!, endFrame: frame, gapFrames: frame - frames[index]!}));
  return {maximumGapFrames: Math.max(0, ...gaps.map(gap => gap.gapFrames)), gaps, pass: gaps.every(gap => gap.gapFrames <= maximumGapFrames)};
}
