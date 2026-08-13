export interface MeaningfulMotionPolicy {
  thumbnailWidth: number;
  thumbnailHeight: number;
  madThreshold: number;
  warningFrames: number;
  failureFrames: number;
}

export const DEFAULT_MEANINGFUL_MOTION_POLICY: MeaningfulMotionPolicy = {
  thumbnailWidth: 64,
  thumbnailHeight: 36,
  madThreshold: 0.35,
  warningFrames: 30,
  failureFrames: 60,
};

export function grayscaleMeanAbsoluteDifference(previous: Uint8Array, current: Uint8Array): number {
  if (previous.length !== current.length || previous.length === 0) throw new Error('Meaningful motion frames must have equal non-zero lengths');
  let total = 0;
  for (let index = 0; index < previous.length; index += 1) total += Math.abs(previous[index]! - current[index]!);
  return total / previous.length;
}

export function packedGrayscaleDifferences(bytes: Uint8Array, frameSize: number): {frameCount: number; differences: number[]} {
  if (!Number.isInteger(frameSize) || frameSize <= 0) throw new Error('frameSize must be a positive integer');
  if (bytes.length === 0 || bytes.length % frameSize !== 0) throw new Error('Packed grayscale bytes must contain complete frames');
  const frameCount = bytes.length / frameSize;
  const differences: number[] = [];
  for (let frame = 1; frame < frameCount; frame += 1) differences.push(grayscaleMeanAbsoluteDifference(
    bytes.subarray((frame - 1) * frameSize, frame * frameSize),
    bytes.subarray(frame * frameSize, (frame + 1) * frameSize),
  ));
  return {frameCount, differences};
}

export function evaluateMeaningfulMotion(differences: readonly number[], policy = DEFAULT_MEANINGFUL_MOTION_POLICY) {
  const runs: Array<{startFrame: number; endFrame: number; lengthFrames: number; averageMad: number; maximumMad: number}> = [];
  let start: number | undefined;
  for (let index = 0; index <= differences.length; index += 1) {
    const low = index < differences.length && differences[index]! < policy.madThreshold;
    if (low && start === undefined) start = index;
    if (low || start === undefined) continue;
    const values = differences.slice(start, index);
    runs.push({
      startFrame: start, endFrame: index, lengthFrames: index - start,
      averageMad: values.reduce((sum, value) => sum + value, 0) / values.length,
      maximumMad: Math.max(...values),
    });
    start = undefined;
  }
  return {
    algorithm: `${policy.thumbnailWidth}x${policy.thumbnailHeight}-grayscale-mad`,
    policy,
    longestRunFrames: Math.max(0, ...runs.map(run => run.lengthFrames)),
    runs,
    warnings: runs.filter(run => run.lengthFrames > policy.warningFrames),
    failures: runs.filter(run => run.lengthFrames > policy.failureFrames),
  };
}
