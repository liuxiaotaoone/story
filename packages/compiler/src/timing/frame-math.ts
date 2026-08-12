export function secondsToFramesCeil(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be finite and nonnegative');
  if (!Number.isInteger(fps) || fps <= 0) throw new RangeError('fps must be a positive integer');
  return Math.ceil(seconds * fps);
}

export function secondsToFramesRound(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be finite and nonnegative');
  if (!Number.isInteger(fps) || fps <= 0) throw new RangeError('fps must be a positive integer');
  return Math.round(seconds * fps);
}

export function secondsToFramesFloor(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be finite and nonnegative');
  if (!Number.isInteger(fps) || fps <= 0) throw new RangeError('fps must be a positive integer');
  return Math.floor(seconds * fps);
}

export function audioSampleFramesToVideoFrames(sampleFrameCount: number, sampleRate: number, fps: number): number {
  if (!Number.isSafeInteger(sampleFrameCount) || sampleFrameCount <= 0) throw new RangeError('sampleFrameCount must be a positive safe integer');
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be a positive safe integer');
  if (!Number.isSafeInteger(fps) || fps <= 0) throw new RangeError('fps must be a positive safe integer');
  const numerator = sampleFrameCount * fps;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('audio to video frame conversion exceeds safe integer range');
  return Math.ceil(numerator / sampleRate);
}
