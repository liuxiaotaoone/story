import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RenderPlanSchema,
  assertRenderPlanIntegrity,
  canonicalHash,
  hashPoseClipContent,
  semanticRenderPlanHash,
  sha256Bytes,
} from '@pose-clip/schemas';

interface TempoPreference {
  readonly decision: string;
  readonly source: {
    readonly tempoComparisonReportByteHash: string;
    readonly candidateProfileHash: string;
    readonly productionResultHash: string;
    readonly sourcePoseClipHash: string;
  };
  readonly selection: {
    readonly label: string;
    readonly cycleFrames: number;
    readonly poseDurations: readonly number[];
  };
  readonly promotion: {
    readonly transitionBaselineAuthorized: boolean;
  };
  readonly nextExperiment: {
    readonly transitionFrames: number;
    readonly transitionMilliseconds: number;
    readonly anchorPolicy: 'foot' | 'center';
  };
  readonly approvalHash: string;
}

interface IntegrationReport {
  readonly sourceProductionResultHash: string;
  readonly candidateProfileHash: string;
  readonly poseClipHash: string;
  readonly frames: ReadonlyArray<{readonly frameIndex: number; readonly contentHash: string}>;
  readonly tempoExperiment: {
    readonly variants: ReadonlyArray<{
      readonly label: string;
      readonly poseClipHash: string;
      readonly renderPlanHash: string;
    }>;
  };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..', '..');
const rendererCandidateRoot = resolve(workspaceRoot, 'experiments', 'renderer-feasibility', 'candidate');
const preferencePath = resolve(root, 'review', 'tempo-human-preference.json');
const tempoReportPath = resolve(root, 'reports', 'pose-tempo-comparison.json');
const integrationReportPath = resolve(root, 'reports', 'candidate-paper-engine-integration.json');
const sourcePlanPath = resolve(rendererCandidateRoot, 'render-plan-tempo-1.0s.json');
const outputPlanPath = resolve(rendererCandidateRoot, 'render-plan-transition-1.0s-100ms.json');
const outputReportPath = resolve(root, 'reports', 'pose-transition-plan.json');

const decode = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
const [preferenceBytes, tempoReportBytes, integrationBytes, sourcePlanBytes] = await Promise.all([
  readFile(preferencePath),
  readFile(tempoReportPath),
  readFile(integrationReportPath),
  readFile(sourcePlanPath),
]);
const preference = decode<TempoPreference>(preferenceBytes);
const integration = decode<IntegrationReport>(integrationBytes);
const sourcePlan = RenderPlanSchema.parse(decode<unknown>(sourcePlanBytes));
const {approvalHash, ...preferencePayload} = preference;
if (await canonicalHash('pose-clip-tempo-human-preference-v1', preferencePayload) !== approvalHash) {
  throw new Error('Tempo Human Preference approvalHash mismatch');
}
if (await sha256Bytes(tempoReportBytes) !== preference.source.tempoComparisonReportByteHash) {
  throw new Error('Tempo Human Preference is detached from the comparison report bytes');
}
if (preference.decision !== 'approved'
  || preference.selection.label !== '1.0s'
  || preference.selection.cycleFrames !== 30
  || !preference.promotion.transitionBaselineAuthorized) {
  throw new Error('1.0s Transition baseline is not Human-authorized');
}
if (preference.nextExperiment.transitionFrames !== 3
  || preference.nextExperiment.transitionMilliseconds !== 100
  || preference.nextExperiment.anchorPolicy !== 'foot') {
  throw new Error('Transition experiment must use the approved 3-frame/100ms foot-anchor policy');
}
const tempoEvidence = integration.tempoExperiment.variants.find(({label}) => label === '1.0s');
if (tempoEvidence === undefined
  || await semanticRenderPlanHash(sourcePlan) !== tempoEvidence.renderPlanHash
  || await hashPoseClipContent(sourcePlan.poseClips[0]!) !== tempoEvidence.poseClipHash) {
  throw new Error('1.0s source RenderPlan is detached from Tempo Experiment evidence');
}

const transitionPlan = structuredClone(sourcePlan);
const sourceClip = transitionPlan.poseClips[0];
const definition = transitionPlan.entities[0];
if (sourceClip === undefined || definition === undefined || sourceClip.frames.length !== 4) {
  throw new Error('Transition experiment requires one four-frame source PoseClip');
}
const poseClips = sourceClip.frames.map((frame, frameIndex) => ({
  ...sourceClip,
  id: `${sourceClip.id}.pose-${frameIndex}`,
  frames: [{...frame, durationFrames: 30}],
}));
transitionPlan.poseClips = poseClips;
definition.poseClipIds = poseClips.map(({id}) => id);
definition.defaultPoseClipId = poseClips[0]!.id;

const transitionStarts = [4, 12, 19, 27] as const;
const poseEvents = [];
const poseTransitions = [];
for (let cycle = 0; cycle < 3; cycle += 1) {
  const cycleStart = cycle * 30;
  for (let fromIndex = 0; fromIndex < 4; fromIndex += 1) {
    const toIndex = (fromIndex + 1) % 4;
    const startFrame = cycleStart + transitionStarts[fromIndex]!;
    const suffix = `c${cycle}-${fromIndex}-to-${toIndex}`;
    poseEvents.push({
      id: `pose-event-${suffix}`,
      frame: startFrame,
      entityId: 'rabbit-real',
      poseClipId: poseClips[toIndex]!.id,
      clipStartOffset: 0,
      playbackRate: 1,
    });
    poseTransitions.push({
      id: `pose-transition-${suffix}`,
      entityId: 'rabbit-real',
      fromPoseClipId: poseClips[fromIndex]!.id,
      toPoseClipId: poseClips[toIndex]!.id,
      startFrame,
      durationFrames: 3,
      mode: 'crossfade' as const,
      anchorPolicy: 'foot' as const,
    });
  }
}
transitionPlan.timeline.poseEvents = poseEvents;
transitionPlan.timeline.poseTransitions = poseTransitions;
transitionPlan.provenance.directorOverrideIds = [
  'review-tempo-1-0s',
  'review-crossfade-100ms-foot-anchor',
];

const admittedPlan = assertRenderPlanIntegrity(transitionPlan);
const transitionPlanHash = await semanticRenderPlanHash(admittedPlan);
const reportPayload = {
  schemaVersion: '1.0.0',
  gate: '1.0s Candidate Pose Transition Plan',
  status: 'PASS',
  reviewOnly: true,
  source: {
    tempoPreferenceApprovalHash: approvalHash,
    candidateProfileHash: integration.candidateProfileHash,
    productionResultHash: integration.sourceProductionResultHash,
    productionPoseClipHash: integration.poseClipHash,
    hardCutRenderPlanHash: tempoEvidence.renderPlanHash,
    hardCutReviewPoseClipHash: tempoEvidence.poseClipHash,
    frameContentHashes: integration.frames.map(({frameIndex, contentHash}) => ({frameIndex, contentHash})),
  },
  transition: {
    type: 'crossfade',
    frames: 3,
    milliseconds: 100,
    anchorPolicy: 'foot',
    cycleFrames: 30,
    cycleSeconds: 1,
    comparisonCycles: 3,
    schedule: {
      pose0: {holdFrames: [0, 3], transitionFrames: [4, 6]},
      pose1: {holdFrames: [7, 11], transitionFrames: [12, 14]},
      pose2: {holdFrames: [15, 18], transitionFrames: [19, 21]},
      pose3: {holdFrames: [22, 26], transitionFrames: [27, 29]},
    },
  },
  poseClips: await Promise.all(poseClips.map(async (clip, frameIndex) => ({
    frameIndex,
    poseClipId: clip.id,
    poseClipHash: await hashPoseClipContent(clip),
    assetId: clip.frames[0]!.assetId,
  }))),
  renderPlanHash: transitionPlanHash,
  limitations: [
    'Crossfade reduces hard-cut shock but may expose double-image ghosting across structurally inconsistent poses.',
    'No AI interpolation or new image generation is performed.',
    'The Production Candidate PoseClip and Candidate Profile remain unchanged.',
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
console.log(`Transition RenderPlan: ${outputPlanPath}\nRenderPlan hash: ${transitionPlanHash}`);
