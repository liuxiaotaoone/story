export const MIN_FRAME_COVERAGE = 0.995;
export const LOW_MOTION_WARNING_FRAMES = 30;
export const LOW_MOTION_FAILURE_FRAMES = 60;
export const MEANINGFUL_MOTION_MAD_THRESHOLD = 0.35;
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

export function grayscaleMeanAbsoluteDifference(previous, current) {
  if (previous.length !== current.length || previous.length === 0) throw new Error('Meaningful motion thumbnails must have equal non-zero lengths');
  let total = 0;
  for (let index = 0; index < previous.length; index += 1) total += Math.abs(previous[index] - current[index]);
  return total / previous.length;
}

export function scanMeaningfulMotion(differences, threshold = MEANINGFUL_MOTION_MAD_THRESHOLD) {
  const runs = [];
  let runStart = null;
  for (let index = 0; index <= differences.length; index += 1) {
    const lowMotion = index < differences.length && differences[index] < threshold;
    if (lowMotion && runStart === null) runStart = index;
    if (lowMotion || runStart === null) continue;
    const transitionCount = index - runStart;
    runs.push({
      startFrame: runStart,
      endFrame: index,
      lengthFrames: transitionCount,
      maximumMad: Math.max(...differences.slice(runStart, index)),
      averageMad: differences.slice(runStart, index).reduce((sum, value) => sum + value, 0) / transitionCount,
    });
    runStart = null;
  }
  const longestRunFrames = Math.max(0, ...runs.map(run => run.lengthFrames));
  return {
    algorithm: '64x36-grayscale-mean-absolute-difference',
    threshold,
    differences,
    runs,
    longestRunFrames,
    warnings: runs.filter(run => run.lengthFrames > LOW_MOTION_WARNING_FRAMES),
    failures: runs.filter(run => run.lengthFrames > LOW_MOTION_FAILURE_FRAMES),
  };
}

function changedKeyframeFrames(keyframes, difference) {
  const frames = [];
  for (let index = 1; index < (keyframes?.length ?? 0); index += 1) {
    if (!difference(keyframes[index - 1].value, keyframes[index].value)) continue;
    const startFrame = keyframes[index - 1].frame;
    const endFrame = keyframes[index].frame;
    frames.push(startFrame);
    for (let frame = startFrame + MAX_VISUAL_EVENT_GAP_FRAMES; frame < endFrame; frame += MAX_VISUAL_EVENT_GAP_FRAMES) frames.push(frame);
    frames.push(endFrame);
  }
  return frames;
}

const pointDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const groundDistance = (left, right) => Math.hypot(left.u - right.u, left.v - right.v);

export function collectMeaningfulVisualEvents(renderPlan) {
  const events = [];
  const add = (frame, type, sourceId) => events.push({frame, type, sourceId});
  for (const shot of renderPlan.timeline.shots) add(shot.range.startFrame, 'shot-cut', shot.id);
  for (const event of renderPlan.timeline.poseEvents) add(event.frame, 'pose-change', event.id);
  for (const transition of renderPlan.timeline.poseTransitions ?? []) {
    add(transition.startFrame, 'pose-transition-start', transition.id);
    add(transition.startFrame + transition.durationFrames, 'pose-transition-end', transition.id);
  }
  for (const event of renderPlan.timeline.visibilityEvents) add(event.frame, 'visibility', event.id);
  for (const event of renderPlan.timeline.ownershipEvents) add(event.frame, 'ownership', event.id);
  for (const event of renderPlan.timeline.effectEvents) add(event.frame, 'effect', event.id);
  for (const track of renderPlan.timeline.entityTracks) {
    for (const frame of changedKeyframeFrames(track.groundPosition, (a, b) => groundDistance(a, b) >= 0.01)) add(frame, 'entity-ground-movement', track.entityId);
    for (const frame of changedKeyframeFrames(track.position, (a, b) => pointDistance(a, b) >= 12)) add(frame, 'entity-position-movement', track.entityId);
    for (const frame of changedKeyframeFrames(track.scale, (a, b) => pointDistance(a, b) >= 0.04)) add(frame, 'entity-scale-change', track.entityId);
    for (const frame of changedKeyframeFrames(track.rotation, (a, b) => Math.abs(a - b) >= 0.035)) add(frame, 'entity-rotation-change', track.entityId);
  }
  for (const track of renderPlan.timeline.cameraTracks) {
    for (const frame of changedKeyframeFrames(track.position, (a, b) => pointDistance(a, b) >= 24)) add(frame, 'camera-position-change', track.shotId);
    for (const frame of changedKeyframeFrames(track.zoom, (a, b) => Math.abs(a - b) >= 0.03)) add(frame, 'camera-zoom-change', track.shotId);
    for (const frame of changedKeyframeFrames(track.rotation, (a, b) => Math.abs(a - b) >= 0.02)) add(frame, 'camera-rotation-change', track.shotId);
  }
  return events.sort((left, right) => left.frame - right.frame || left.type.localeCompare(right.type) || left.sourceId.localeCompare(right.sourceId));
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
