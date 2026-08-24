import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  BilateralAlphaGeometryPoseFrameAnchorDetector,
  BorderConnectedChromaKeyPoseFrameMattingProcessor,
  CanonicalCanvasPoseFrameNormalizer,
  LocalCasAssetByteResolver,
  LocalContentAddressedAssetStore,
  POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  PoseClipProductionOrchestrator,
  RequiredAnchorPoseFrameQaEvaluator,
  RgbaPoseClipContinuityFeatureExtractor,
  inspectPng,
  type GeneratedImageArtifact,
  type ImageGenerationProvider,
} from '@pose-clip/asset-generation';
import {
  RuntimeModelDependencySchema,
  canonicalHash,
  contentAddressedAssetUri,
  createActionGenerationRequest,
  createPoseClipContinuityFeatureExtractorSpec,
  createPoseClipContinuityQaSpec,
  createPoseClipFrameJob,
  createPoseClipFrameSpec,
  createPoseClipProductionProfile,
  createPoseClipProductionRequest,
  createPoseFrameProcessorSpec,
  createPoseFrameQaEvaluatorSpec,
  poseFrameExecutionKey,
  sha256Bytes,
  type ActionGenerationRequest,
  type PoseClipFrameJob,
} from '@pose-clip/schemas';
import {type FrozenProductionE2eManifest} from '../src/production-quality-analysis.ts';

interface CandidateVisualApproval {
  readonly decision: string;
  readonly source: {
    readonly mattingCalibrationResultHash: string;
    readonly anchorCalibrationResultHash: string;
    readonly overlayReviewResultHash: string;
    readonly candidateMattingSpecHash: string;
    readonly candidateAnchorSpecHash: string;
  };
  readonly promotion: {
    readonly candidateProfileAuthorized: boolean;
    readonly productionApprovalGranted: boolean;
    readonly continuityThresholdsCalibrated: boolean;
  };
  readonly approvalHash: string;
}

interface AnchorCalibrationReport {
  readonly calibrationResultHash: string;
  readonly frames: ReadonlyArray<{
    readonly frameIndex: number;
    readonly candidateAnchoredContentHash: string;
  }>;
}

interface QualitySpec {
  readonly schemaVersion: '1.0.0';
  readonly normalization: {
    readonly processor: {readonly name: string; readonly version: string};
    readonly config: Parameters<typeof createPoseFrameProcessorSpec>[0] extends {config: infer T} ? T : never;
  };
}

const REPLAY_TIME = '2026-08-24T09:22:20.000Z';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.env.M4_E2E_PASS_MANIFEST_PATH
  ?? resolve(root, 'frozen', 'production-e2e-pass-manifest.json');
const modelCatalogPath = resolve(root, 'model-catalog.arc130t.json');
const mattingSpecPath = resolve(root, 'calibration', 'chroma-key-matting-border-candidate-v1.json');
const anchorSpecPath = resolve(root, 'calibration', 'alpha-geometry-anchor-bilateral-candidate-v1.json');
const qualitySpecPath = resolve(root, 'frozen', 'rgba-quality-baseline-spec.json');
const approvalPath = resolve(root, 'review', 'candidate-visual-approval.json');
const overlayReviewPath = resolve(root, 'reports', 'anchor-overlay-review.json');
const anchorCalibrationPath = resolve(root, 'reports', 'anchor-calibration.json');
const frozenRawCasRoot = process.env.M4_E2E_CAS_ROOT ?? resolve(root, 'generated', 'production-e2e', 'cas');
const replayRoot = process.env.M4_CANDIDATE_REPLAY_ROOT
  ?? resolve(root, 'generated', 'candidate-production-replay');
const replayCasRoot = resolve(replayRoot, 'cas');
const profileOutputPath = resolve(root, 'frozen', 'candidate-production-profile-vnext.json');
const productionResultOutputPath = resolve(root, 'review', 'candidate-production-result.json');
const candidateFrameOutputRoot = resolve(root, 'review', 'candidate-frames');
const reportOutputPath = process.env.M4_CANDIDATE_REPLAY_REPORT_PATH
  ?? resolve(root, 'reports', 'candidate-production-replay.json');

const decodeJson = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
const [
  manifestBytes,
  modelCatalogBytes,
  mattingSpecBytes,
  anchorSpecBytes,
  qualitySpecBytes,
  approvalBytes,
  overlayReviewBytes,
  anchorCalibrationBytes,
] = await Promise.all([
  readFile(manifestPath),
  readFile(modelCatalogPath),
  readFile(mattingSpecPath),
  readFile(anchorSpecPath),
  readFile(qualitySpecPath),
  readFile(approvalPath),
  readFile(overlayReviewPath),
  readFile(anchorCalibrationPath),
]);
const manifest = decodeJson<FrozenProductionE2eManifest>(manifestBytes);
const modelCatalog = decodeJson<{
  readonly models: ReadonlyArray<{role: 'diffusion-model' | 'text-encoder' | 'vae'; modelId: string; contentHash: string}>;
}>(modelCatalogBytes);
const runtimeModels = modelCatalog.models.map((model) => RuntimeModelDependencySchema.parse(model));
const approval = decodeJson<CandidateVisualApproval>(approvalBytes);
const overlayReview = decodeJson<{readonly overlayReviewResultHash: string}>(overlayReviewBytes);
const anchorCalibration = decodeJson<AnchorCalibrationReport>(anchorCalibrationBytes);
const {approvalHash, ...approvalPayload} = approval;
if (
  manifest.status !== 'PASS'
  || approval.decision !== 'approved'
  || !approval.promotion.candidateProfileAuthorized
  || approval.promotion.productionApprovalGranted
  || approval.promotion.continuityThresholdsCalibrated
  || await canonicalHash('pose-clip-candidate-visual-approval-v1', approvalPayload) !== approvalHash
  || approval.source.overlayReviewResultHash !== overlayReview.overlayReviewResultHash
  || approval.source.anchorCalibrationResultHash !== anchorCalibration.calibrationResultHash
  || await sha256Bytes(modelCatalogBytes) !== manifest.admission.modelCatalogHash
) throw new Error('CANDIDATE_REPLAY_ADMISSION_INVALID');

const phases = [
  {
    phase: 'settle',
    poseIntent: 'Neutral loop start, both paws planted',
    prompt: 'Calm neutral idle pose, both feet planted evenly, body settled, ears relaxed.',
    seed: 2026082201,
  },
  {
    phase: 'inhale',
    poseIntent: 'Gentle inhale with a small body rise',
    prompt: 'Gentle inhale idle phase, torso raised slightly, both feet planted, ears a little more upright.',
    seed: 2026082202,
  },
  {
    phase: 'hold',
    poseIntent: 'Small centered breathing hold',
    prompt: 'Centered breathing hold, subtle chest lift, both feet planted evenly, complete whole body visible.',
    seed: 2026082203,
  },
  {
    phase: 'exhale',
    poseIntent: 'Gentle exhale returning toward loop start',
    prompt: 'Gentle exhale returning toward the neutral start pose, both feet planted, ears relaxed.',
    seed: 2026082204,
  },
] as const;
const frames: PoseClipFrameJob[] = [];
for (const [frameIndex, phase] of phases.entries()) {
  const output = {assetId: `rabbit.idle-left.real.${frameIndex + 1}`, kind: 'animal-frame' as const};
  const spec = await createPoseClipFrameSpec({
    frameIndex,
    phase: phase.phase,
    poseIntent: phase.poseIntent,
    durationFrames: 3,
    contact: 'both',
    referenceFoot: 'midpoint',
    requiredAnchors: ['foot', 'center', 'leftFoot', 'rightFoot'],
    seed: phase.seed,
    referenceAssets: [{assetId: 'rabbit.reference', contentHash: manifest.admission.referenceAssetHash}],
    output,
  });
  const generationRequest = await createActionGenerationRequest({
    schemaVersion: '1.0.0',
    actionPackageId: 'rabbit.idle',
    entityType: 'rabbit',
    action: 'idle',
    direction: 'left',
    frameSpecHash: spec.frameSpecHash,
    workflowId: manifest.admission.workflowId,
    workflowHash: manifest.admission.workflowHash,
    provider: 'comfyui',
    runtimeModels,
    prompt: [
      'Use the reference rabbit as the exact character identity and paper-cut watercolor style.',
      phase.prompt,
      'Facing left, all ears and paws visible, centered, no crop.',
      'Perfectly flat uniform #00ff00 bright green background, no shadow and no scenery.',
    ].join(' '),
    negativePrompt: [
      'cropped body', 'missing feet', 'extra limbs', 'duplicate rabbit', 'text',
      'scenery', 'shadow', 'gradient background', 'photorealistic',
    ].join(', '),
    seed: phase.seed,
    referenceAssets: spec.referenceAssets,
    output: {...output, nodeId: '17', expectedCount: 1},
  });
  frames.push(await createPoseClipFrameJob({spec, generationRequest}));
}
const request = await createPoseClipProductionRequest({
  schemaVersion: '1.0.0',
  id: 'rabbit.idle-left.real-production-e2e',
  actionPackageId: 'rabbit.idle',
  poseClipId: 'rabbit.idle-left.real',
  entityType: 'rabbit',
  action: 'idle',
  direction: 'left',
  loop: true,
  rootMotion: {mode: 'timeline'},
  groundLock: {mode: 'contact-only', maxCorrectionPx: 24},
  frames,
});
if (request.requestHash !== manifest.admission.productionRequestHash) {
  throw new Error('CANDIDATE_REPLAY_PRODUCTION_REQUEST_DRIFT');
}

const mattingSpec = await createPoseFrameProcessorSpec(
  decodeJson<Parameters<typeof createPoseFrameProcessorSpec>[0]>(mattingSpecBytes),
);
const qualitySpec = decodeJson<QualitySpec>(qualitySpecBytes);
const normalizationSpec = await createPoseFrameProcessorSpec({
  schemaVersion: qualitySpec.schemaVersion,
  stage: 'normalized',
  processor: qualitySpec.normalization.processor,
  config: qualitySpec.normalization.config,
});
const anchorSpec = await createPoseFrameProcessorSpec(
  decodeJson<Parameters<typeof createPoseFrameProcessorSpec>[0]>(anchorSpecBytes),
);
if (
  mattingSpec.processorSpecHash !== approval.source.candidateMattingSpecHash
  || anchorSpec.processorSpecHash !== approval.source.candidateAnchorSpecHash
) throw new Error('CANDIDATE_REPLAY_PROCESSOR_SPEC_NOT_APPROVED');
const frameQaSpec = await createPoseFrameQaEvaluatorSpec({
  schemaVersion: '1.0.0',
  evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
  config: {},
});
const continuityFeatureSpec = await createPoseClipContinuityFeatureExtractorSpec({
  schemaVersion: '1.0.0',
  extractor: {name: 'rgba-continuity-features', version: '1.0.0'},
  config: {alphaThreshold: 8, colorBins: 8, silhouetteGridSize: 8},
});
const collectionThreshold = {warning: 1, failure: 2};
const continuityQaSpec = await createPoseClipContinuityQaSpec({
  schemaVersion: '1.0.0',
  evaluator: {name: 'deterministic-pose-clip-continuity', version: '1.0.0'},
  featureExtractor: continuityFeatureSpec,
  thresholds: {
    identityConsistency: collectionThreshold,
    scaleConsistency: collectionThreshold,
    canvasConsistency: collectionThreshold,
    bodyProportion: collectionThreshold,
    footContact: collectionThreshold,
    anchorMovement: collectionThreshold,
    silhouetteContinuity: collectionThreshold,
    loopClosure: collectionThreshold,
  },
});
const processorSpecHashes = {
  matted: mattingSpec.processorSpecHash,
  normalized: normalizationSpec.processorSpecHash,
  anchored: anchorSpec.processorSpecHash,
};
const frameExecutionKeys = await Promise.all(frames.map((job) => poseFrameExecutionKey({
  frameJobHash: job.frameJobHash,
  processorSpecHashes,
  qaEvaluatorSpecHash: frameQaSpec.qaEvaluatorSpecHash,
  executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
})));
const profile = await createPoseClipProductionProfile({
  schemaVersion: '1.0.0',
  profileId: 'rabbit-idle-real-gpu-candidate-vnext',
  approval: 'pending',
  processorSpecs: {matted: mattingSpec, normalized: normalizationSpec, anchored: anchorSpec},
  frameQaSpec,
  continuityQaSpec,
  executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  modelHashes: runtimeModels.map(({modelId, contentHash}) => ({modelId, contentHash})),
  frameExecutionKeys,
});
const plan = {
  schemaVersion: '1.0.0' as const,
  mode: 'frozen-admitted-raw-replay' as const,
  sourceTrustedProfileHash: manifest.admission.trustedProfileHash,
  productionRequestHash: request.requestHash,
  candidateProfileHash: profile.profileHash,
  processorSpecHashes,
  frameExecutionKeys,
  visualApprovalHash: approvalHash,
};
if (process.argv.includes('--plan')) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

class FrozenAdmittedRawProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';
  readonly #framesByInputHash = new Map(request.frames.map((frame, index) => [
    frame.generationRequest.inputHash,
    manifest.frames[index]!,
  ]));

  async generate(generationRequest: ActionGenerationRequest): Promise<GeneratedImageArtifact[]> {
    const frozenFrame = this.#framesByInputHash.get(generationRequest.inputHash);
    if (frozenFrame === undefined) throw new Error('CANDIDATE_REPLAY_RAW_FRAME_NOT_ADMITTED');
    const contentHash = frozenFrame.artifacts.raw;
    const filePath = resolve(frozenRawCasRoot, `${contentHash}.png`);
    const bytes = new Uint8Array(await readFile(filePath));
    if (await sha256Bytes(bytes) !== contentHash) throw new Error(
      `CANDIDATE_REPLAY_RAW_CONTENT_HASH_MISMATCH:${frozenFrame.frameIndex}`,
    );
    const metadata = inspectPng(bytes);
    return [{
      bytes,
      filePath,
      asset: {
        id: generationRequest.output.assetId,
        uri: contentAddressedAssetUri(contentHash),
        contentHash,
        source: 'generated',
        provenance: {
          inputHash: generationRequest.inputHash,
          producer: {name: 'frozen-admitted-raw-replay', version: '1.0.0'},
          createdAt: REPLAY_TIME,
        },
        qaStatus: 'pending',
        kind: generationRequest.output.kind,
        width: metadata.width,
        height: metadata.height,
        alphaMode: metadata.alphaMode,
      },
      providerMetadata: {
        mode: 'frozen-admitted-raw-replay',
        frozenFrameExecutionKey: frozenFrame.frameExecutionKey,
        frozenRawContentHash: contentHash,
      },
    }];
  }
}

const cas = new LocalContentAddressedAssetStore(replayCasRoot);
const resolver = new LocalCasAssetByteResolver(replayCasRoot);
const execution = await new PoseClipProductionOrchestrator({
  trustedProfileHash: profile.profileHash,
  provider: new FrozenAdmittedRawProvider(),
  rawCas: cas,
  matting: {resolver, cas, processor: new BorderConnectedChromaKeyPoseFrameMattingProcessor()},
  normalization: {resolver, cas, processor: new CanonicalCanvasPoseFrameNormalizer()},
  anchoring: {resolver, cas, processor: new BilateralAlphaGeometryPoseFrameAnchorDetector()},
  frameQaEvaluator: new RequiredAnchorPoseFrameQaEvaluator(),
  continuityFeatureExtractor: new RgbaPoseClipContinuityFeatureExtractor(resolver),
  maxAttempts: 1,
  now: () => new Date(REPLAY_TIME),
}).execute({request, productionProfile: profile, humanReview: 'approved'});

await mkdir(candidateFrameOutputRoot, {recursive: true});
const frameEvidence = [];
for (const [frameIndex, frameResult] of execution.frameResults.entries()) {
  const expectedAnchoredHash = anchorCalibration.frames[frameIndex]?.candidateAnchoredContentHash;
  const actualAnchoredHash = frameResult.artifacts[3]!.asset.contentHash;
  if (actualAnchoredHash !== expectedAnchoredHash) throw new Error(
    `CANDIDATE_REPLAY_ANCHORED_CALIBRATION_MISMATCH:${frameIndex}`,
  );
  const resolved = await resolver.resolve(frameResult.artifacts[3]!.asset);
  if (await sha256Bytes(resolved.bytes) !== actualAnchoredHash) throw new Error(
    `CANDIDATE_REPLAY_ANCHORED_CAS_MISMATCH:${frameIndex}`,
  );
  const reviewFileName = `frame-${frameIndex}.png`;
  await writeFile(resolve(candidateFrameOutputRoot, reviewFileName), resolved.bytes);
  frameEvidence.push({
    frameIndex,
    frameExecutionKey: frameResult.frameExecutionKey,
    frameResultHash: frameResult.resultHash,
    artifacts: Object.fromEntries(frameResult.artifacts.map(({stage, asset}) => [stage, asset.contentHash])),
    anchors: frameResult.poseFrame.anchors,
    frameQa: frameResult.qa,
    reviewFileName,
  });
}
if (execution.result.qa.productionReady) throw new Error('CANDIDATE_REPLAY_MUST_NOT_BE_PRODUCTION_READY');
const reportPayload = {
  schemaVersion: '1.0.0' as const,
  gate: 'M4 Commit 8.4 — Candidate Production Replay From Admitted Raw',
  status: 'PASS' as const,
  plan,
  source: {
    frozenPoseClipHash: manifest.production.poseClipHash,
    frozenProductionResultHash: manifest.production.resultHash,
    visualApprovalHash: approvalHash,
  },
  candidate: {
    profileHash: profile.profileHash,
    profileApproval: profile.approval,
    poseClipHash: execution.result.poseClipHash,
    productionResultHash: execution.result.resultHash,
    humanReview: execution.result.qa.humanReview,
    productionReady: execution.result.qa.productionReady,
  },
  frames: frameEvidence,
  continuity: {
    thresholdPolicy: 'collection-only-not-calibrated' as const,
    status: execution.continuityEvaluation.continuity,
    automatedReady: execution.continuityEvaluation.automatedReady,
    metrics: execution.continuityEvaluation.metrics,
    diagnostics: execution.continuityEvaluation.diagnostics,
    evaluationHash: execution.continuityEvaluation.evaluationHash,
  },
  limitations: [
    'Raw pixels are reused from the admitted M4 Commit 7 GPU run; no new GPU generation occurred.',
    'Profile approval remains pending, so the replay result is not productionReady.',
    'Continuity thresholds remain collection-only and are not production calibrated.',
    'leftFoot/rightFoot retain screen-side support semantics, not anatomical semantics.',
  ],
};
const report = {
  ...reportPayload,
  timingsMs: execution.timingsMs,
  replayResultHash: await canonicalHash('pose-clip-candidate-production-replay-v1', reportPayload),
};
await Promise.all([
  mkdir(dirname(profileOutputPath), {recursive: true}),
  mkdir(dirname(productionResultOutputPath), {recursive: true}),
  mkdir(dirname(reportOutputPath), {recursive: true}),
]);
await Promise.all([
  writeFile(profileOutputPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8'),
  writeFile(productionResultOutputPath, `${JSON.stringify(execution.result, null, 2)}\n`, 'utf8'),
  writeFile(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
]);
console.log(JSON.stringify(report, null, 2));
