import {
  effectivePoseSwitchFrame,
  type PoseTransition,
  type Timeline,
} from '@pose-clip/schemas';

export interface PoseSelection {
  poseClipId: string;
  startFrame: number;
  clipStartOffset: number;
  playbackRate: number;
  opacity: number;
  transition?: {
    transitionId: string;
    role: 'from' | 'to';
  };
}

function latestPoseEvent(timeline: Timeline, entityId: string, frame: number) {
  return timeline.poseEvents
    .filter((event) => event.entityId === entityId && event.frame <= frame)
    .reduce<typeof timeline.poseEvents[number] | undefined>(
      (latest, event) => latest === undefined || event.frame > latest.frame ? event : latest,
      undefined,
    );
}

function activeCrossfade(timeline: Timeline, entityId: string, frame: number): PoseTransition | undefined {
  return timeline.poseTransitions.find((transition) =>
    transition.entityId === entityId
    && transition.mode === 'crossfade'
    && frame >= transition.startFrame
    && frame < transition.startFrame + transition.durationFrames,
  );
}

export function resolvePoseSelections(
  timeline: Timeline,
  entityId: string,
  defaultPoseClipId: string,
  frame: number,
): PoseSelection[] {
  const transition = activeCrossfade(timeline, entityId, frame);
  if (transition !== undefined) {
    const previousEvent = latestPoseEvent(timeline, entityId, transition.startFrame - 1);
    const toEvent = timeline.poseEvents.find((event) =>
      event.entityId === entityId
      && event.poseClipId === transition.toPoseClipId
      && event.frame === effectivePoseSwitchFrame(transition),
    );
    if (toEvent === undefined) throw new Error(`Transition ${transition.id} has no matching to-pose event`);
    const progress = (frame - transition.startFrame) / transition.durationFrames;
    return [
      {
        poseClipId: transition.fromPoseClipId,
        startFrame: previousEvent?.frame ?? 0,
        clipStartOffset: previousEvent?.clipStartOffset ?? 0,
        playbackRate: previousEvent?.playbackRate ?? 1,
        opacity: 1 - progress,
        transition: {transitionId: transition.id, role: 'from'},
      },
      {
        poseClipId: transition.toPoseClipId,
        startFrame: toEvent.frame,
        clipStartOffset: toEvent.clipStartOffset,
        playbackRate: toEvent.playbackRate,
        opacity: progress,
        transition: {transitionId: transition.id, role: 'to'},
      },
    ];
  }

  const event = latestPoseEvent(timeline, entityId, frame);
  return [{
    poseClipId: event?.poseClipId ?? defaultPoseClipId,
    startFrame: event?.frame ?? 0,
    clipStartOffset: event?.clipStartOffset ?? 0,
    playbackRate: event?.playbackRate ?? 1,
    opacity: 1,
  }];
}
