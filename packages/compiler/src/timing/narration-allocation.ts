import type {MeasuredAudio, NarrationSegment, TtsRequest} from '@pose-clip/schemas';
import {audioSampleFramesToVideoFrames} from './frame-math.js';
import type {SolvedNarrationTiming} from './types.js';

export function allocateNarration(input: {
  segments: readonly NarrationSegment[];
  ttsRequests: readonly TtsRequest[];
  measuredAudio: readonly MeasuredAudio[];
  fps: number;
  startFrame: number;
}): {timings: SolvedNarrationTiming[]; durationFrames: number} {
  const requests = new Map(input.ttsRequests.map(request => [request.segmentId, request]));
  const audio = new Map(input.measuredAudio.map(measured => [measured.requestId, measured]));
  const timings: SolvedNarrationTiming[] = [];
  let cursor = input.startFrame;
  for (const segment of input.segments) {
    const request = requests.get(segment.id);
    if (request === undefined) throw new Error(`Missing TTS request for segment ${segment.id}`);
    const measured = audio.get(request.id);
    if (measured === undefined) throw new Error(`Missing MeasuredAudio for request ${request.id}`);
    const durationFrames = audioSampleFramesToVideoFrames(measured.sampleFrameCount, measured.sampleRate, input.fps);
    timings.push({
      segmentId: segment.id, ttsRequestId: request.id, audioAssetId: measured.assetId,
      startFrame: cursor, endFrame: cursor + durationFrames,
    });
    cursor += durationFrames;
  }
  return {timings, durationFrames: cursor - input.startFrame};
}
