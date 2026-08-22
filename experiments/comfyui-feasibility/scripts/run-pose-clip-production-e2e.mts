import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  AlphaGeometryPoseFrameAnchorDetector,
  CanonicalCanvasPoseFrameNormalizer,
  ChromaKeyPoseFrameMattingProcessor,
  ComfyUiProvider,
  LocalCasAssetByteResolver,
  LocalContentAddressedAssetStore,
  POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  PoseClipProductionOrchestrator,
  RequiredAnchorPoseFrameQaEvaluator,
  RgbaPoseClipContinuityFeatureExtractor,
  decodeRgbaPng8,
  type PoseClipContinuityFeatureExtractor,
  type PoseClipContinuityFeatureExtractorInput,
} from '@pose-clip/asset-generation';
import {
  RuntimeModelDependencySchema,
  canonicalizeJson,
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
  type PoseClipContinuityFrameFeatures,
  type PoseClipFrameJob,
} from '@pose-clip/schemas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowId = 'flux2-klein-reference-single-frame-v1';
const workflowPath = resolve(root, 'workflows', `${workflowId}.api.json`);
const modelCatalogPath = resolve(root, 'model-catalog.arc130t.json');
const referencePath = resolve(root, '..', 'asset-feasibility', 'processed', 'rabbit', 'rabbit-reference.png');
const admissionPath = resolve(root, 'frozen', 'production-e2e-admission.json');
const runRoot = resolve(root, 'generated', 'production-e2e');
const reportPath = process.env.M4_E2E_REPORT_PATH ?? resolve(root, 'reports', 'production-e2e.json');
const endpoint = process.env.COMFYUI_ENDPOINT ?? 'http://127.0.0.1:8188';
const modelRoot = process.env.COMFYUI_MODEL_ROOT;
const workflowBytes = new Uint8Array(await readFile(workflowPath));
const referenceBytes = new Uint8Array(await readFile(referencePath));
const modelCatalogBytes = new Uint8Array(await readFile(modelCatalogPath));
const modelCatalog = JSON.parse(new TextDecoder().decode(modelCatalogBytes)) as {
  models: Array<{role: 'diffusion-model' | 'text-encoder' | 'vae'; modelId: string; contentHash: string}>;
};
const runtimeModels = modelCatalog.models.map((model) => RuntimeModelDependencySchema.parse(model));
const workflowHash = await sha256Bytes(workflowBytes);
const referenceHash = await sha256Bytes(referenceBytes);
const modelCatalogHash = await sha256Bytes(modelCatalogBytes);

async function productionInputs() {
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
      referenceAssets: [{assetId: 'rabbit.reference', contentHash: referenceHash}],
      output,
    });
    const generationRequest = await createActionGenerationRequest({
      schemaVersion: '1.0.0',
      actionPackageId: 'rabbit.idle',
      entityType: 'rabbit',
      action: 'idle',
      direction: 'left',
      frameSpecHash: spec.frameSpecHash,
      workflowId,
      workflowHash,
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
  const matted = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'matted',
    processor: {name: 'chroma-key-matting', version: '1.0.0'},
    config: {
      keyColor: [0, 255, 0],
      transparentThreshold: 0.04,
      opaqueThreshold: 0.22,
      spillSuppression: 1,
    },
  });
  const normalized = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'normalized',
    processor: {name: 'canonical-canvas-normalize', version: '1.0.1'},
    config: {
      canvasWidth: 512,
      canvasHeight: 768,
      targetForegroundHeight: 640,
      maxForegroundWidth: 430,
      bottomPadding: 32,
      alphaThreshold: 8,
      resampling: 'bilinear-premultiplied',
    },
  });
  const anchored = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'anchored',
    processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
    config: {alphaThreshold: 8, footBandHeight: 12},
  });
  const frameQaSpec = await createPoseFrameQaEvaluatorSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
    config: {},
  });
  const featureExtractor = await createPoseClipContinuityFeatureExtractorSpec({
    schemaVersion: '1.0.0',
    extractor: {name: 'rgba-continuity-features', version: '1.0.0'},
    config: {alphaThreshold: 8, colorBins: 8, silhouetteGridSize: 8},
  });
  const collectionThreshold = {warning: 1, failure: 2};
  const continuityQaSpec = await createPoseClipContinuityQaSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'deterministic-pose-clip-continuity', version: '1.0.0'},
    featureExtractor,
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
    matted: matted.processorSpecHash,
    normalized: normalized.processorSpecHash,
    anchored: anchored.processorSpecHash,
  };
  const frameExecutionKeys = await Promise.all(frames.map((job) => poseFrameExecutionKey({
    frameJobHash: job.frameJobHash,
    processorSpecHashes,
    qaEvaluatorSpecHash: frameQaSpec.qaEvaluatorSpecHash,
    executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  })));
  const profile = await createPoseClipProductionProfile({
    schemaVersion: '1.0.0',
    profileId: 'rabbit-idle-real-gpu-collection-v1',
    approval: 'pending',
    processorSpecs: {matted, normalized, anchored},
    frameQaSpec,
    continuityQaSpec,
    executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
    modelHashes: runtimeModels.map(({modelId, contentHash}) => ({modelId, contentHash})),
    frameExecutionKeys,
  });
  return {request, profile};
}

const {request, profile} = await productionInputs();
const plan = {
  schemaVersion: '1.0.0',
  workflow: {id: workflowId, contentHash: workflowHash},
  modelCatalogHash,
  referenceAsset: {assetId: 'rabbit.reference', contentHash: referenceHash},
  productionRequestHash: request.requestHash,
  trustedProfileHash: profile.profileHash,
  frameExecutionKeys: profile.frameExecutionKeys,
};

if (process.argv.includes('--plan')) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const admitted = JSON.parse(new TextDecoder().decode(await readFile(admissionPath))) as typeof plan;
if (canonicalizeJson(admitted) !== canonicalizeJson(plan)) {
  throw new Error('Real GPU E2E inputs do not match frozen production-e2e-admission.json');
}

class RecordingFeatureExtractor implements PoseClipContinuityFeatureExtractor {
  readonly id = 'rgba-continuity-features';
  readonly version = '1.0.0';
  readonly features: PoseClipContinuityFrameFeatures[] = [];
  readonly #inner: RgbaPoseClipContinuityFeatureExtractor;

  constructor(inner: RgbaPoseClipContinuityFeatureExtractor) {
    this.#inner = inner;
  }

  async extract(input: PoseClipContinuityFeatureExtractorInput): Promise<PoseClipContinuityFrameFeatures> {
    const feature = await this.#inner.extract(input);
    this.features.push(structuredClone(feature));
    return feature;
  }
}

class E2eEnvironmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'E2eEnvironmentError';
    this.code = code;
  }
}

interface RuntimeModelVerification {
  role: 'diffusion-model' | 'text-encoder' | 'vae';
  modelId: string;
  relativePath: string;
  admittedContentHash: string;
  runtimeContentHash: string;
  sizeBytes: number;
  verified: boolean;
}

const runtimeModelVerification: RuntimeModelVerification[] = [];

async function sha256File(path: string): Promise<{contentHash: string; sizeBytes: number}> {
  const file = await open(path, 'r');
  try {
    const stats = await file.stat();
    const hash = createHash('sha256');
    const buffer = new Uint8Array(8 * 1024 * 1024);
    let position = 0;
    while (true) {
      const {bytesRead} = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return {contentHash: hash.digest('hex'), sizeBytes: stats.size};
  } finally {
    await file.close();
  }
}

async function verifyRuntimeModelBytes(): Promise<void> {
  const hostname = new URL(endpoint).hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new E2eEnvironmentError(
      'REAL_GPU_REMOTE_MODEL_EVIDENCE_UNSUPPORTED',
      'Remote ComfyUI requires a trusted Worker Model Manifest; local model paths cannot prove remote GPU model bytes',
    );
  }
  if (modelRoot === undefined || modelRoot.trim().length === 0) throw new E2eEnvironmentError(
    'REAL_GPU_MODEL_ROOT_MISSING',
    'COMFYUI_MODEL_ROOT must point to the local ComfyUI models directory',
  );
  const roleDirectories = {
    'diffusion-model': 'diffusion_models',
    'text-encoder': 'text_encoders',
    vae: 'vae',
  } as const;
  for (const model of runtimeModels) {
    const directoryName = roleDirectories[model.role];
    const directory = resolve(modelRoot, directoryName);
    const path = resolve(directory, model.modelId);
    if (!path.startsWith(`${directory}${sep}`)) throw new E2eEnvironmentError(
      'REAL_GPU_MODEL_PATH_INVALID',
      `${model.role}:${model.modelId}`,
    );
    let runtime: Awaited<ReturnType<typeof sha256File>>;
    try {
      runtime = await sha256File(path);
    } catch (error) {
      throw new E2eEnvironmentError(
        'REAL_GPU_MODEL_READ_FAILED',
        `${directoryName}/${model.modelId}`,
        {cause: error},
      );
    }
    const evidence = {
      role: model.role,
      modelId: model.modelId,
      relativePath: `${directoryName}/${model.modelId}`,
      admittedContentHash: model.contentHash,
      runtimeContentHash: runtime.contentHash,
      sizeBytes: runtime.sizeBytes,
      verified: runtime.contentHash === model.contentHash,
    };
    runtimeModelVerification.push(evidence);
    if (!evidence.verified) throw new E2eEnvironmentError(
      'REAL_GPU_MODEL_HASH_MISMATCH',
      `${model.role}:${model.modelId}`,
    );
  }
}

async function systemStats(): Promise<unknown> {
  const url = new URL('system_stats', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(5_000)});
    if (!response.ok) throw new E2eEnvironmentError(
      'REAL_GPU_COMFYUI_READINESS_FAILED',
      `ComfyUI system_stats at ${endpoint} failed with HTTP ${response.status}`,
    );
    return response.json();
  } catch (error) {
    if (error instanceof E2eEnvironmentError) throw error;
    throw new E2eEnvironmentError(
      'REAL_GPU_COMFYUI_UNAVAILABLE',
      `ComfyUI is unavailable at ${endpoint}`,
      {cause: error},
    );
  }
}

const startedAt = new Date();
let report: Record<string, unknown> = {
  schemaVersion: '1.0.0',
  gate: 'M4 Commit 7 — Real GPU Production E2E',
  status: 'RUNNING',
};
let provider: ComfyUiProvider | undefined;
try {
  await verifyRuntimeModelBytes();
  const environment = await systemStats();
  const casRoot = resolve(runRoot, 'cas');
  const cas = new LocalContentAddressedAssetStore(casRoot);
  const resolver = new LocalCasAssetByteResolver(casRoot);
  const recordingExtractor = new RecordingFeatureExtractor(
    new RgbaPoseClipContinuityFeatureExtractor(resolver),
  );
  provider = new ComfyUiProvider({
    endpoint,
    workflowResolver: async (requestedId) => {
      if (requestedId !== workflowId) throw new Error(`Unknown workflow: ${requestedId}`);
      return workflowBytes;
    },
    referenceResolver: async (assetId) => {
      if (assetId !== 'rabbit.reference') throw new Error(`Unknown reference asset: ${assetId}`);
      return {bytes: referenceBytes};
    },
    timeoutMs: 20 * 60_000,
  });
  const execution = await new PoseClipProductionOrchestrator({
    trustedProfileHash: admitted.trustedProfileHash,
    provider,
    rawCas: cas,
    matting: {resolver, cas, processor: new ChromaKeyPoseFrameMattingProcessor()},
    normalization: {resolver, cas, processor: new CanonicalCanvasPoseFrameNormalizer()},
    anchoring: {resolver, cas, processor: new AlphaGeometryPoseFrameAnchorDetector()},
    frameQaEvaluator: new RequiredAnchorPoseFrameQaEvaluator(),
    continuityFeatureExtractor: recordingExtractor,
    maxAttempts: 2,
  }).execute({request, productionProfile: profile, humanReview: 'pending'});
  const frames = [];
  for (const [frameIndex, frameResult] of execution.frameResults.entries()) {
    const finalAsset = frameResult.artifacts[3]!.asset;
    const decoded = decodeRgbaPng8((await resolver.resolve(finalAsset)).bytes);
    let visiblePixels = 0;
    let alphaTotal = 0;
    for (let offset = 3; offset < decoded.pixels.length; offset += 4) {
      const alpha = decoded.pixels[offset]!;
      if (alpha >= 8) visiblePixels += 1;
      alphaTotal += alpha;
    }
    frames.push({
      frameIndex,
      generation: execution.raw.frames[frameIndex],
      matting: execution.matting.frames[frameIndex],
      normalization: execution.normalization.frames[frameIndex],
      anchoring: execution.anchoring.frames[frameIndex],
      artifacts: frameResult.artifacts.map(({stage, outputHash, asset}) => ({
        stage,
        artifactHash: outputHash,
        contentHash: asset.contentHash,
        width: asset.width,
        height: asset.height,
      })),
      subjectBounds: recordingExtractor.features[frameIndex]!.subjectBounds,
      anchors: frameResult.poseFrame.anchors,
      alphaCoverage: visiblePixels / (decoded.width * decoded.height),
      meanAlpha: alphaTotal / (decoded.width * decoded.height * 255),
      frameExecutionKey: frameResult.frameExecutionKey,
      frameResultHash: frameResult.resultHash,
    });
  }
  report = {
    schemaVersion: '1.0.0',
    gate: 'M4 Commit 7 — Real GPU Production E2E',
    status: 'PASS',
    environment: {endpoint, runtimeModels: runtimeModelVerification, systemStats: environment},
    plan,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    timingsMs: execution.timingsMs,
    frames,
    continuity: {
      status: execution.continuityEvaluation.continuity,
      automatedReady: execution.continuityEvaluation.automatedReady,
      metrics: execution.continuityEvaluation.metrics,
      diagnostics: execution.continuityEvaluation.diagnostics,
      evaluationHash: execution.continuityEvaluation.evaluationHash,
    },
    production: {
      productionReady: execution.result.qa.productionReady,
      humanReview: execution.result.qa.humanReview,
      profileApproval: execution.result.productionProfile.approval,
      diagnostics: execution.result.qa.diagnostics,
      poseClipHash: execution.result.poseClipHash,
      resultHash: execution.result.resultHash,
    },
  };
} catch (error) {
  report = {
    schemaVersion: '1.0.0',
    gate: 'M4 Commit 7 — Real GPU Production E2E',
    status: error instanceof E2eEnvironmentError ? 'BLOCKED' : 'FAIL',
    environment: {endpoint, runtimeModels: runtimeModelVerification},
    plan,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    error: {
      name: error instanceof Error ? error.name : 'Error',
      ...(error instanceof E2eEnvironmentError ? {code: error.code} : {}),
      message: error instanceof Error ? error.message : String(error),
    },
  };
  process.exitCode = 1;
} finally {
  if (provider !== undefined) {
    try {
      await provider.releaseResources();
      report.resourceRelease = {status: 'PASS'};
    } catch (error) {
      report.status = 'FAIL';
      report.resourceRelease = {
        status: 'FAIL',
        message: error instanceof Error ? error.message : String(error),
      };
      process.exitCode = 1;
    }
  }
}

await mkdir(dirname(reportPath), {recursive: true});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
