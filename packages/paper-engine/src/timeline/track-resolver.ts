import type {CameraState, GroundPoint, Point, Timeline} from '@pose-clip/schemas';
import {evaluateGroundPointKeyframes, evaluateNumberKeyframes, evaluatePointKeyframes} from '../interpolation/keyframe-evaluator.js';

type EntityTrack = Timeline['entityTracks'][number];

export interface ResolvedEntityTrack {
  groundPosition?: GroundPoint;
  worldPosition?: Point;
  scale: Point;
  rotation: number;
  opacity: number;
}

export function resolveEntityTrack(track: EntityTrack | undefined, frame: number): ResolvedEntityTrack {
  const result: ResolvedEntityTrack = {
    scale: track?.scale === undefined ? {x: 1, y: 1} : evaluatePointKeyframes(track.scale, frame),
    rotation: track?.rotation === undefined ? 0 : evaluateNumberKeyframes(track.rotation, frame),
    opacity: track?.opacity === undefined ? 1 : evaluateNumberKeyframes(track.opacity, frame),
  };
  if (track?.groundPosition !== undefined) result.groundPosition = evaluateGroundPointKeyframes(track.groundPosition, frame);
  if (track?.worldPosition !== undefined) result.worldPosition = evaluatePointKeyframes(track.worldPosition, frame);
  return result;
}

export function resolveCamera(timeline: Timeline, shotId: string, frame: number): CameraState {
  const track = timeline.cameraTracks.find((candidate) => candidate.shotId === shotId);
  return resolveCameraTrack(track, frame);
}

export function resolveCameraTrack(track: Timeline['cameraTracks'][number] | undefined, frame: number): CameraState {
  return {
    position: track === undefined ? {x: 0, y: 0} : evaluatePointKeyframes(track.position, frame),
    zoom: track === undefined ? 1 : evaluateNumberKeyframes(track.zoom, frame),
    rotation: track?.rotation === undefined ? 0 : evaluateNumberKeyframes(track.rotation, frame),
  };
}
