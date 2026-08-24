import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RenderPlanSchema,
  hashPoseClipContent,
  semanticRenderPlanHash,
  sha256Bytes,
  type PoseClip,
  type VisualAssetRecord,
} from '@pose-clip/schemas';

interface CandidateProductionResult {
  readonly productionProfile: {readonly profileHash: string};
  readonly poseClip: PoseClip;
  readonly frameResults: ReadonlyArray<{
    readonly frameIndex: number;
    readonly qa: {readonly productionReady: boolean};
    readonly artifacts: ReadonlyArray<{
      readonly stage: string;
      readonly asset: VisualAssetRecord;
    }>;
  }>;
  readonly qa: {readonly humanReview: string};
  readonly resultHash: string;
}

const COMPILED_AT = '2026-08-24T09:22:20.000Z';
const DURATION_FRAMES = 120;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..', '..');
const rendererCandidateRoot = resolve(workspaceRoot, 'experiments', 'renderer-feasibility', 'candidate');
const sourceResultPath = resolve(root, 'review', 'candidate-production-result.json');
const sourceFrameRoot = resolve(root, 'review', 'candidate-frames');
const renderPlanPath = resolve(rendererCandidateRoot, 'render-plan.json');
const reportPath = resolve(root, 'reports', 'candidate-paper-engine-integration.json');

const sourceResult = JSON.parse(new TextDecoder().decode(await readFile(sourceResultPath))) as CandidateProductionResult;
if (sourceResult.qa.humanReview !== 'approved') {
  throw new Error('Candidate Production Result must have approved Human Review before renderer admission');
}
if (sourceResult.frameResults.length !== 4 || sourceResult.poseClip.frames.length !== 4) {
  throw new Error('Candidate renderer admission requires exactly four frames');
}

await mkdir(resolve(rendererCandidateRoot, 'assets'), {recursive: true});
const assets: VisualAssetRecord[] = [];
const admittedFrames: Array<{
  frameIndex: number;
  assetId: string;
  contentHash: string;
  uri: string;
}> = [];

for (const frameResult of sourceResult.frameResults) {
  if (!frameResult.qa.productionReady) {
    throw new Error(`Frame ${frameResult.frameIndex} did not pass Frame Production QA`);
  }
  const anchored = frameResult.artifacts.find(artifact => artifact.stage === 'anchored');
  if (anchored === undefined) throw new Error(`Frame ${frameResult.frameIndex} has no anchored artifact`);
  const sourcePath = resolve(sourceFrameRoot, `frame-${frameResult.frameIndex}.png`);
  const bytes = await readFile(sourcePath);
  const actualHash = await sha256Bytes(bytes);
  if (actualHash !== anchored.asset.contentHash) {
    throw new Error(`Frame ${frameResult.frameIndex} byte hash does not match anchored evidence`);
  }
  const uri = `/candidate/assets/frame-${frameResult.frameIndex}.png`;
  await writeFile(resolve(rendererCandidateRoot, 'assets', `frame-${frameResult.frameIndex}.png`), bytes);
  assets.push({...anchored.asset, uri, qaStatus: 'passed'});
  admittedFrames.push({
    frameIndex: frameResult.frameIndex,
    assetId: anchored.asset.id,
    contentHash: anchored.asset.contentHash,
    uri,
  });
}

const renderPlan = RenderPlanSchema.parse({
  schemaVersion: '1.0.0',
  project: {
    id: 'rabbit-real-candidate-video',
    title: 'First Real Rabbit PoseClip',
    fps: 30,
    resolution: {width: 1280, height: 720},
    sampleRate: 48_000,
    seed: 483921,
    styleGuideId: 'paper-style',
    capabilityCatalogVersion: '1.0.0',
  },
  assets: {schemaVersion: '1.0.0', assets},
  environments: [{
    id: 'candidate-stage',
    name: 'Candidate Review Stage',
    referenceResolution: {width: 1280, height: 720},
    layers: [],
    ground: {
      farLeft: {x: 0.08, y: 0.72},
      farRight: {x: 0.92, y: 0.72},
      nearLeft: {x: 0.02, y: 0.90},
      nearRight: {x: 0.98, y: 0.90},
      // The admitted PoseClip caps GroundLock visual correction at 24 px.
      // At 0.275 scale the widest screen-side support midpoint remains within that
      // frozen contract without changing PoseClip or Anchor evidence.
      farScale: 0.275,
      nearScale: 0.275,
      depthEasing: 'linear',
      walkableZones: [],
    },
    occlusionZones: [],
  }],
  entities: [{
    id: 'rabbit-real-def',
    entityType: 'rabbit',
    displayName: 'Real Rabbit Candidate',
    poseClipIds: [sourceResult.poseClip.id],
    defaultPoseClipId: sourceResult.poseClip.id,
    attachmentSlots: [],
  }],
  instances: [{
    id: 'rabbit-real',
    definitionId: 'rabbit-real-def',
    sceneId: 'scene-real-rabbit',
    activeRange: {startFrame: 0, endFrame: DURATION_FRAMES},
    initialOwner: {kind: 'world', environmentId: 'candidate-stage'},
  }],
  poseClips: [sourceResult.poseClip],
  timeline: {
    schemaVersion: '1.0.0',
    fps: 30,
    durationFrames: DURATION_FRAMES,
    shots: [{
      id: 'shot-real-rabbit',
      sceneId: 'scene-real-rabbit',
      environmentId: 'candidate-stage',
      range: {startFrame: 0, endFrame: DURATION_FRAMES},
      focusEntityId: 'rabbit-real',
    }],
    entityTracks: [{
      entityId: 'rabbit-real',
      groundPosition: [{frame: 0, value: {u: 0.5, v: 0.5}, easing: 'hold'}],
    }],
    cameraTracks: [{
      shotId: 'shot-real-rabbit',
      position: [{frame: 0, value: {x: 640, y: 465}, easing: 'hold'}],
      zoom: [{frame: 0, value: 2.2, easing: 'hold'}],
    }],
    poseEvents: [],
    poseTransitions: [],
    ownershipEvents: [],
    visibilityEvents: [],
    effectEvents: [],
    narration: [],
    subtitles: [],
    sfx: [],
    transitions: [],
    markers: [],
  },
  provenance: {
    compilerVersion: '1.0.0',
    sourceDirectorPlanHash: sourceResult.resultHash,
    effectiveDirectorPlanHash: sourceResult.productionProfile.profileHash,
    directorOverrideIds: [],
    capabilityCatalogVersion: '1.0.0',
    compiledAt: COMPILED_AT,
    warnings: [],
  },
});

const renderPlanHash = await semanticRenderPlanHash(renderPlan);
const tempoSpecs = [
  {label: '0.8s', poseDurations: [6, 6, 6, 6]},
  {label: '1.0s', poseDurations: [7, 8, 7, 8]},
  {label: '1.2s', poseDurations: [9, 9, 9, 9]},
] as const;
const tempoVariants = [];
for (const tempoSpec of tempoSpecs) {
  const variant = structuredClone(renderPlan);
  const clip = variant.poseClips[0];
  const instance = variant.instances[0];
  const shot = variant.timeline.shots[0];
  if (clip === undefined || instance === undefined || shot === undefined || clip.frames.length !== 4) {
    throw new Error('Tempo comparison requires one instance, one shot and exactly four PoseClip frames');
  }
  clip.frames = clip.frames.map((frame, frameIndex) => ({
    ...frame,
    durationFrames: tempoSpec.poseDurations[frameIndex]!,
  }));
  const cycleFrames = tempoSpec.poseDurations.reduce((sum, duration) => sum + duration, 0);
  const comparisonDurationFrames = cycleFrames * 3;
  instance.activeRange.endFrame = comparisonDurationFrames;
  shot.range.endFrame = comparisonDurationFrames;
  variant.timeline.durationFrames = comparisonDurationFrames;
  variant.provenance.directorOverrideIds = [`review-tempo-${tempoSpec.label.replaceAll('.', '-')}`];
  const parsedVariant = RenderPlanSchema.parse(variant);
  const fileName = `render-plan-tempo-${tempoSpec.label}.json`;
  const variantPath = resolve(rendererCandidateRoot, fileName);
  await writeFile(variantPath, `${JSON.stringify(parsedVariant, null, 2)}\n`);
  tempoVariants.push({
    label: tempoSpec.label,
    fileName,
    reviewOnly: true,
    transitionMode: 'none-hard-cut-control',
    poseDurations: [...tempoSpec.poseDurations],
    cycleFrames,
    cycleSeconds: cycleFrames / 30,
    comparisonCycles: 3,
    durationFrames: comparisonDurationFrames,
    durationSeconds: comparisonDurationFrames / 30,
    poseClipHash: await hashPoseClipContent(parsedVariant.poseClips[0]!),
    renderPlanHash: await semanticRenderPlanHash(parsedVariant),
  });
}
const report = {
  schemaVersion: '1.0.0',
  gate: 'Candidate PoseClip → Paper Engine Admission',
  status: 'PASS',
  sourceProductionResultHash: sourceResult.resultHash,
  candidateProfileHash: sourceResult.productionProfile.profileHash,
  poseClipId: sourceResult.poseClip.id,
  poseClipHash: await hashPoseClipContent(sourceResult.poseClip),
  renderPlanHash,
  durationFrames: DURATION_FRAMES,
  fps: 30,
  groundLockPolicy: {
    contact: 'both',
    referenceFoot: 'midpoint',
    footFields: 'screen-side-support-not-anatomical',
    reviewStageScale: 0.275,
    reviewCameraZoom: 2.2,
    frozenMaxVisualCorrectionPx: 24,
  },
  frames: admittedFrames,
  tempoExperiment: {
    isolation: 'same-assets-same-anchors-same-ground-lock-same-camera-no-crossfade',
    sourcePoseClipUnchanged: true,
    variants: tempoVariants,
  },
};

await mkdir(dirname(renderPlanPath), {recursive: true});
await mkdir(dirname(reportPath), {recursive: true});
await writeFile(renderPlanPath, `${JSON.stringify(renderPlan, null, 2)}\n`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Candidate RenderPlan: ${renderPlanPath}\nRenderPlan hash: ${renderPlanHash}`);
