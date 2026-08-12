import type {CameraIntentDefinition, EnvironmentDefinition, Timeline} from '@pose-clip/schemas';
import {evaluateGroundPointKeyframes, projectGround} from '@pose-clip/paper-engine';
import type {SolvedShotTiming} from '../timing/types.js';

type CameraTrack = Timeline['cameraTracks'][number];

function endFrame(timing: SolvedShotTiming): number {
  return Math.max(timing.startFrame, timing.endFrame - 1);
}

function baseZoom(shotType: 'wide' | 'medium' | 'close-up'): number {
  if (shotType === 'close-up') return 1.25;
  if (shotType === 'medium') return 1.1;
  return 1;
}

export function compileCameraTrack(input: {
  intent: CameraIntentDefinition;
  shotType: 'wide' | 'medium' | 'close-up';
  timing: SolvedShotTiming;
  focusEntityTrack?: Timeline['entityTracks'][number];
  environment: EnvironmentDefinition;
}): CameraTrack {
  const {intent, timing} = input;
  const last = endFrame(timing);
  const zoom = baseZoom(input.shotType);
  if (intent.type === 'follow') {
    if (intent.focusEntityId === undefined || input.focusEntityTrack?.groundPosition === undefined) {
      throw new Error(`Follow camera ${intent.id} requires a ground-position track for its focus entity`);
    }
    const focusTrack = input.focusEntityTrack.groundPosition;
    const frames = [...new Set([
      timing.startFrame,
      ...focusTrack
        .filter(keyframe => keyframe.frame > timing.startFrame && keyframe.frame < last)
        .map(keyframe => keyframe.frame),
      last,
    ])].sort((left, right) => left - right);
    return {
      shotId: timing.shotId,
      position: frames.map((frame, index) => ({
        frame,
        value: projectGround(input.environment, evaluateGroundPointKeyframes(focusTrack, frame)).worldFootPosition,
        easing: index === frames.length - 1 ? 'hold' : 'linear',
      })),
      zoom: [{frame: timing.startFrame, value: zoom, easing: 'hold'}],
    };
  }
  const positionStart = intent.type === 'pan-left' ? {x: 700, y: 360}
    : intent.type === 'pan-right' ? {x: 580, y: 360}
      : {x: 640, y: 360};
  const positionEnd = intent.type === 'pan-left' ? {x: 580, y: 360}
    : intent.type === 'pan-right' ? {x: 700, y: 360}
      : positionStart;
  const zoomStart = intent.type === 'slow-pull-out' ? zoom + 0.12 : zoom;
  const zoomEnd = intent.type === 'slow-push-in' ? zoom + 0.12 : zoom;
  return {
    shotId: timing.shotId,
    position: last === timing.startFrame
      ? [{frame: timing.startFrame, value: positionStart, easing: 'hold'}]
      : [
          {frame: timing.startFrame, value: positionStart, easing: 'linear'},
          {frame: last, value: positionEnd, easing: 'hold'},
        ],
    zoom: last === timing.startFrame || zoomStart === zoomEnd
      ? [{frame: timing.startFrame, value: zoomStart, easing: 'hold'}]
      : [
          {frame: timing.startFrame, value: zoomStart, easing: 'linear'},
          {frame: last, value: zoomEnd, easing: 'hold'},
        ],
  };
}
