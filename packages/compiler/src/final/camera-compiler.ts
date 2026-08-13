import type {CameraComposition, CameraIntentDefinition, EnvironmentDefinition, Timeline} from '@pose-clip/schemas';
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

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

function focusFrames(input: {
  timing: SolvedShotTiming;
  focusTrack: NonNullable<Timeline['entityTracks'][number]['groundPosition']>;
}): number[] {
  const last = endFrame(input.timing);
  return [...new Set([
    input.timing.startFrame,
    ...input.focusTrack.filter(keyframe => keyframe.frame > input.timing.startFrame && keyframe.frame < last).map(keyframe => keyframe.frame),
    last,
  ])].sort((left, right) => left - right);
}

function composedCameraPosition(input: {
  world: {x: number; y: number};
  composition: CameraComposition;
  environment: EnvironmentDefinition;
}): {x: number; y: number} {
  const desiredX = input.composition.subjectScreenX * 1280;
  const desiredY = input.composition.subjectScreenY * 720;
  const raw = {x: input.world.x + 640 - desiredX, y: input.world.y + 360 - desiredY};
  const bounds = input.environment.cameraSafeBounds;
  return bounds === undefined ? raw : {
    x: clamp(raw.x, bounds.minX, bounds.maxX),
    y: clamp(raw.y, bounds.minY, bounds.maxY),
  };
}

export function compileCameraTrack(input: {
  intent: CameraIntentDefinition;
  shotType: 'wide' | 'medium' | 'close-up';
  timing: SolvedShotTiming;
  focusEntityTrack?: Timeline['entityTracks'][number];
  focusEntityId?: string;
  composition?: CameraComposition;
  environment: EnvironmentDefinition;
}): CameraTrack {
  const {intent, timing} = input;
  const last = endFrame(timing);
  const zoom = baseZoom(input.shotType);
  if (input.focusEntityId !== undefined && input.focusEntityTrack?.groundPosition !== undefined
    && (intent.type === 'follow' || input.composition !== undefined)) {
    const focusTrack = input.focusEntityTrack.groundPosition;
    const frames = focusFrames({timing, focusTrack});
    const composition = input.composition;
    const positions = frames.map((frame, index) => {
      const world = projectGround(input.environment, evaluateGroundPointKeyframes(focusTrack, frame)).worldFootPosition;
      return {
        frame,
        value: composition === undefined ? world : composedCameraPosition({world, composition, environment: input.environment}),
        easing: index === frames.length - 1 ? 'hold' as const : composition === undefined ? 'linear' as const : 'ease-in-out' as const,
      };
    });
    const zoomEnd = intent.type === 'slow-push-in' ? zoom + 0.12 : intent.type === 'slow-pull-out' ? Math.max(0.1, zoom - 0.12) : zoom;
    return {
      shotId: timing.shotId,
      position: positions,
      zoom: last === timing.startFrame || zoom === zoomEnd
        ? [{frame: timing.startFrame, value: zoom, easing: 'hold'}]
        : [{frame: timing.startFrame, value: zoom, easing: 'ease-in-out'}, {frame: last, value: zoomEnd, easing: 'hold'}],
    };
  }
  if (intent.type === 'follow') {
    if (input.focusEntityId === undefined || input.focusEntityTrack?.groundPosition === undefined) {
      throw new Error(`Follow camera ${intent.id} requires a ground-position track for its focus entity`);
    }
    const focusTrack = input.focusEntityTrack.groundPosition;
    const frames = focusFrames({timing, focusTrack});
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
