import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RenderPlanSchema,
  assertRenderPlanIntegrity,
  canonicalHash,
  semanticRenderPlanHash,
  sha256Bytes,
} from '@pose-clip/schemas';

interface TransitionHumanReview {
  readonly decision: string;
  readonly source: {
    readonly transitionPlanResultHash: string;
    readonly transitionVideoReportByteHash: string;
    readonly transitionVideoHash: string;
  };
  readonly promotion: {
    readonly transition100msDefaultAuthorized: boolean;
    readonly transition2FrameExperimentAuthorized: boolean;
    readonly closeTransitionTuningAfter2FrameExperiment: boolean;
    readonly generationConsistencyBecomesPrimary: boolean;
  };
  readonly nextExperiment: {
    readonly cycleSeconds: number;
    readonly transitionFrames: number;
    readonly transitionMilliseconds: number;
    readonly anchorPolicy: 'foot' | 'center';
  };
  readonly approvalHash: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..', '..');
const rendererCandidateRoot = resolve(workspaceRoot, 'experiments', 'renderer-feasibility', 'candidate');
const reviewPath = resolve(root, 'review', 'transition-100ms-human-review.json');
const videoReportPath = resolve(root, 'reports', 'pose-transition-video.json');
const sourcePlanReportPath = resolve(root, 'reports', 'pose-transition-plan.json');
const sourcePlanPath = resolve(rendererCandidateRoot, 'render-plan-transition-1.0s-100ms.json');
const outputPlanPath = resolve(rendererCandidateRoot, 'render-plan-transition-1.0s-67ms.json');
const outputReportPath = resolve(root, 'reports', 'pose-transition-67ms-plan.json');
const decode = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

const [reviewBytes, videoReportBytes, sourcePlanReportBytes, sourcePlanBytes] = await Promise.all([
  readFile(reviewPath),
  readFile(videoReportPath),
  readFile(sourcePlanReportPath),
  readFile(sourcePlanPath),
]);
const review = decode<TransitionHumanReview>(reviewBytes);
const videoReport = decode<any>(videoReportBytes);
const sourcePlanReport = decode<any>(sourcePlanReportBytes);
const sourcePlan = RenderPlanSchema.parse(decode<unknown>(sourcePlanBytes));
const {approvalHash, ...reviewPayload} = review;
if (await canonicalHash('pose-clip-transition-human-review-v1', reviewPayload) !== approvalHash) {
  throw new Error('100ms Transition Human Review approvalHash mismatch');
}
if (await sha256Bytes(videoReportBytes) !== review.source.transitionVideoReportByteHash
  || videoReport.video.contentHash !== review.source.transitionVideoHash
  || sourcePlanReport.transitionPlanResultHash !== review.source.transitionPlanResultHash) {
  throw new Error('100ms Transition Human Review is detached from source evidence');
}
if (review.decision !== 'not-approved-as-default'
  || review.promotion.transition100msDefaultAuthorized
  || !review.promotion.transition2FrameExperimentAuthorized
  || !review.promotion.closeTransitionTuningAfter2FrameExperiment
  || !review.promotion.generationConsistencyBecomesPrimary
  || review.nextExperiment.transitionFrames !== 2
  || review.nextExperiment.anchorPolicy !== 'foot') {
  throw new Error('2-frame Transition experiment is not Human-authorized');
}
if (await semanticRenderPlanHash(sourcePlan) !== sourcePlanReport.renderPlanHash) {
  throw new Error('100ms Transition RenderPlan hash mismatch');
}

const transitionPlan = structuredClone(sourcePlan);
for (const transition of transitionPlan.timeline.poseTransitions) {
  const previousStart = transition.startFrame;
  const matchingEvent = transitionPlan.timeline.poseEvents.find(event =>
    event.entityId === transition.entityId
    && event.poseClipId === transition.toPoseClipId
    && event.frame === previousStart,
  );
  if (matchingEvent === undefined) throw new Error(`Transition ${transition.id} has no matching Pose Event`);
  transition.startFrame = previousStart + 1;
  transition.durationFrames = 2;
  matchingEvent.frame = previousStart + 1;
}
transitionPlan.provenance.directorOverrideIds = [
  'review-tempo-1-0s',
  'review-crossfade-67ms-foot-anchor',
];

const admittedPlan = assertRenderPlanIntegrity(transitionPlan);
const renderPlanHash = await semanticRenderPlanHash(admittedPlan);
const reportPayload = {
  schemaVersion: '1.0.0',
  gate: '1.0s Candidate 2-Frame Pose Transition Plan',
  status: 'PASS',
  reviewOnly: true,
  source: {
    transition100msHumanReviewApprovalHash: approvalHash,
    transition100msVideoHash: review.source.transitionVideoHash,
    transition100msPlanResultHash: review.source.transitionPlanResultHash,
    transition100msRenderPlanHash: sourcePlanReport.renderPlanHash,
    productionPoseClipHash: sourcePlanReport.source.productionPoseClipHash,
    frameContentHashes: sourcePlanReport.source.frameContentHashes,
  },
  transition: {
    type: 'crossfade',
    frames: 2,
    milliseconds: 2000 / 30,
    primaryBlendFramesPerTransition: 1,
    anchorPolicy: 'foot',
    cycleFrames: 30,
    cycleSeconds: 1,
    comparisonCycles: 3,
    schedule: {
      pose0: {holdFrames: [0, 4], transitionFrames: [5, 6]},
      pose1: {holdFrames: [7, 12], transitionFrames: [13, 14]},
      pose2: {holdFrames: [15, 19], transitionFrames: [20, 21]},
      pose3: {holdFrames: [22, 27], transitionFrames: [28, 29]},
    },
  },
  renderPlanHash,
  closure: {
    furtherTransitionDurationTuningPlanned: false,
    nextPrimaryWorkstream: 'comfyui-generation-consistency',
  },
  limitations: [
    'One 50/50 blend frame remains visible at each transition.',
    'This experiment cannot repair structural Generation inconsistency.',
    'Matting, Normalize, Anchor, GroundLock and source asset bytes are unchanged.',
  ],
};
const report = {
  ...reportPayload,
  transitionPlanResultHash: await canonicalHash('pose-clip-transition-plan-v1', reportPayload),
};
await mkdir(dirname(outputPlanPath), {recursive: true});
await mkdir(dirname(outputReportPath), {recursive: true});
await writeFile(outputPlanPath, `${JSON.stringify(admittedPlan, null, 2)}\n`);
await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`67ms Transition RenderPlan: ${outputPlanPath}\nRenderPlan hash: ${renderPlanHash}`);
