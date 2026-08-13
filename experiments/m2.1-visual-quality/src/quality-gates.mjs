export const MIN_FRAME_COVERAGE = 0.995;
export const FREEZE_WARNING_FRAMES = 30;
export const FREEZE_FAILURE_FRAMES = 60;
export const MAX_VISUAL_EVENT_GAP_FRAMES = 120;

export const REQUIRED_STORY_ACTIONS = [
  'rabbit.run-left',
  'rabbit.collision',
  'rabbit.lying',
  'farmer.notice-right',
  'farmer.walk-right',
  'farmer.bend',
  'farmer.pickup',
  'farmer.hold-rabbit',
];

export function evaluateCoverage(pixelStats, minimum = MIN_FRAME_COVERAGE) {
  const frameCoverage = pixelStats.validPixelCount / pixelStats.totalPixelCount;
  const edgeCoverage = pixelStats.edgeValidPixelCount / pixelStats.edgePixelCount;
  return {frameCoverage, edgeCoverage, pass: frameCoverage >= minimum && edgeCoverage >= minimum};
}

export function scanFreezeRuns(hashes) {
  const runs = [];
  let startFrame = 0;
  for (let frame = 1; frame <= hashes.length; frame += 1) {
    if (frame < hashes.length && hashes[frame] === hashes[frame - 1]) continue;
    const lengthFrames = frame - startFrame;
    if (lengthFrames > 1) runs.push({startFrame, endFrame: frame, lengthFrames});
    startFrame = frame;
  }
  const longestRunFrames = Math.max(1, ...runs.map(run => run.lengthFrames));
  return {
    runs,
    longestRunFrames,
    warnings: runs.filter(run => run.lengthFrames > FREEZE_WARNING_FRAMES),
    failures: runs.filter(run => run.lengthFrames > FREEZE_FAILURE_FRAMES),
  };
}

export function evaluateVisualEventCadence(eventFrames, durationFrames) {
  const normalized = [...new Set([0, durationFrames - 1, ...eventFrames])]
    .filter(frame => Number.isInteger(frame) && frame >= 0 && frame < durationFrames)
    .sort((left, right) => left - right);
  const gaps = normalized.slice(1).map((frame, index) => ({
    startFrame: normalized[index],
    endFrame: frame,
    gapFrames: frame - normalized[index],
  }));
  const maximumGapFrames = Math.max(0, ...gaps.map(gap => gap.gapFrames));
  return {eventFrames: normalized, gaps, maximumGapFrames, pass: maximumGapFrames <= MAX_VISUAL_EVENT_GAP_FRAMES};
}

export function evaluateStoryActions(renderPlan, required = REQUIRED_STORY_ACTIONS) {
  const present = [...new Set(renderPlan.timeline.poseEvents.map(event => event.poseClipId))];
  const missing = required.filter(poseClipId => !present.includes(poseClipId));
  const stumpPresent = renderPlan.instances.some(instance => instance.id === 'stump');
  return {required, present, missing, stumpPresent, pass: missing.length === 0 && stumpPresent};
}

export function evaluateCameraSafeBounds(renderPlan, bounds) {
  const violations = renderPlan.timeline.cameraTracks.flatMap(track => track.position
    .filter(keyframe => keyframe.value.x < bounds.minX || keyframe.value.x > bounds.maxX || keyframe.value.y < bounds.minY || keyframe.value.y > bounds.maxY)
    .map(keyframe => ({shotId: track.shotId, frame: keyframe.frame, position: keyframe.value})));
  return {bounds, violations, pass: violations.length === 0};
}

export function evaluateCharacterScale(renderPlan, farmerAssetId = 'farmer-idle', rabbitAssetId = 'rabbit-run-1') {
  const assets = renderPlan.assets.assets;
  const farmer = assets.find(asset => asset.id === farmerAssetId);
  const rabbit = assets.find(asset => asset.id === rabbitAssetId);
  const relativeHeight = farmer?.height && rabbit?.height ? rabbit.height / farmer.height : Number.NaN;
  const pass = Number.isFinite(relativeHeight) && relativeHeight >= 0.3 && relativeHeight <= 0.4;
  return {farmerAssetId, rabbitAssetId, relativeHeight, allowedRange: {minimum: 0.3, maximum: 0.4}, pass};
}
