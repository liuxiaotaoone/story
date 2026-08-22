import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  ProductionVisualAssetSchema,
  assertPoseClipProductionResultIntegrity,
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
  type PoseClipFrameJob,
  type PoseClipProductionProfile,
  type PoseClipProductionRequest,
} from '@pose-clip/schemas';
import {
  AlphaGeometryPoseFrameAnchorDetector,
  CanonicalCanvasPoseFrameNormalizer,
  ChromaKeyPoseFrameMattingProcessor,
  DeterministicReferencePoseFrameProcessor,
  LocalCasAssetByteResolver,
  LocalContentAddressedAssetStore,
  POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  PoseClipProductionOrchestrator,
  PoseClipProductionOrchestratorError,
  RequiredAnchorPoseFrameQaEvaluator,
  RgbaPoseClipContinuityFeatureExtractor,
  encodeRgbaPng,
  type GeneratedImageArtifact,
  type ImageGenerationProvider,
  type PoseFrameProcessor,
} from '../src/index.js';

const roots: string[] = [];
const RAW_PNG = encodeRgbaPng({
  width: 4,
  height: 4,
  pixels: Uint8Array.from([
    0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255,
    0, 255, 0, 255, 240, 32, 16, 255, 240, 32, 16, 255, 0, 255, 0, 255,
    0, 255, 0, 255, 240, 32, 16, 255, 240, 32, 16, 255, 0, 255, 0, 255,
    0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255,
  ]),
});
const RUNTIME_MODELS = [
  {role: 'diffusion-model' as const, modelId: 'flux-2.safetensors', contentHash: '2'.repeat(64)},
  {role: 'text-encoder' as const, modelId: 'qwen.safetensors', contentHash: '3'.repeat(64)},
  {role: 'vae' as const, modelId: 'flux2-vae.safetensors', contentHash: '4'.repeat(64)},
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

class CountingGenerationProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';
  calls = 0;

  async generate(request: PoseClipFrameJob['generationRequest']): Promise<GeneratedImageArtifact[]> {
    this.calls += 1;
    const contentHash = await sha256Bytes(RAW_PNG);
    return [{
      bytes: RAW_PNG,
      filePath: `virtual://${contentHash}.png`,
      asset: ProductionVisualAssetSchema.parse({
        id: request.output.assetId,
        kind: request.output.kind,
        uri: contentAddressedAssetUri(contentHash),
        contentHash,
        source: 'generated',
        provenance: {
          inputHash: request.inputHash,
          promptHash: 'a'.repeat(64),
          modelId: request.runtimeModels[0]!.modelId,
          seed: request.seed,
          producer: {name: 'comfyui-provider', version: '0.1.2'},
          createdAt: '2026-08-22T00:00:00.000Z',
        },
        qaStatus: 'pending',
        width: 4,
        height: 4,
        alphaMode: 'straight',
      }),
      providerMetadata: {fixture: true},
    }];
  }
}

async function productionRequest(): Promise<PoseClipProductionRequest> {
  const frames: PoseClipFrameJob[] = [];
  for (let frameIndex = 0; frameIndex < 4; frameIndex += 1) {
    const output = {assetId: `rabbit.run-left.${frameIndex + 1}`, kind: 'animal-frame' as const};
    const spec = await createPoseClipFrameSpec({
      frameIndex,
      phase: `phase-${frameIndex}`,
      poseIntent: `Rabbit run phase ${frameIndex + 1}`,
      durationFrames: 3,
      contact: 'both',
      referenceFoot: 'midpoint',
      requiredAnchors: ['foot', 'center', 'leftFoot', 'rightFoot'],
      seed: 7400 + frameIndex,
      referenceAssets: [],
      output,
    });
    const generationRequest = await createActionGenerationRequest({
      schemaVersion: '1.0.0',
      actionPackageId: 'rabbit.run',
      entityType: 'rabbit',
      action: 'run',
      direction: 'left',
      frameSpecHash: spec.frameSpecHash,
      workflowId: 'm4-production-orchestrator',
      workflowHash: '1'.repeat(64),
      provider: 'comfyui',
      runtimeModels: RUNTIME_MODELS,
      prompt: `Whole-body rabbit run phase ${frameIndex + 1}`,
      negativePrompt: 'cropped feet, extra limbs',
      seed: spec.seed,
      referenceAssets: [],
      output: {...output, nodeId: '17', expectedCount: 1},
    });
    frames.push(await createPoseClipFrameJob({spec, generationRequest}));
  }
  return createPoseClipProductionRequest({
    schemaVersion: '1.0.0',
    id: 'rabbit.run.production',
    actionPackageId: 'rabbit.run',
    poseClipId: 'rabbit.run-left',
    entityType: 'rabbit',
    action: 'run',
    direction: 'left',
    loop: true,
    rootMotion: {mode: 'timeline'},
    groundLock: {mode: 'contact-only', maxCorrectionPx: 24},
    frames,
  });
}

async function productionProfile(
  request: PoseClipProductionRequest,
  changes: {modelHashes?: Array<{modelId: string; contentHash: string}>; frameExecutionKeys?: string[]} = {},
): Promise<PoseClipProductionProfile> {
  const matted = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'matted',
    processor: {name: 'chroma-key-matting', version: '1.0.0'},
    config: {
      keyColor: [0, 255, 0],
      transparentThreshold: 0.05,
      opaqueThreshold: 0.2,
      spillSuppression: 1,
    },
  });
  const normalized = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'normalized',
    processor: {name: 'canonical-canvas-normalize', version: '1.0.1'},
    config: {
      canvasWidth: 4,
      canvasHeight: 4,
      targetForegroundHeight: 2,
      maxForegroundWidth: 2,
      bottomPadding: 0,
      alphaThreshold: 1,
      resampling: 'bilinear-premultiplied',
    },
  });
  const anchored = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'anchored',
    processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
    config: {alphaThreshold: 1, footBandHeight: 1},
  });
  const frameQaSpec = await createPoseFrameQaEvaluatorSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
    config: {},
  });
  const featureExtractor = await createPoseClipContinuityFeatureExtractorSpec({
    schemaVersion: '1.0.0',
    extractor: {name: 'rgba-continuity-features', version: '1.0.0'},
    config: {alphaThreshold: 1, colorBins: 2, silhouetteGridSize: 2},
  });
  const threshold = {warning: 0.1, failure: 0.2};
  const continuityQaSpec = await createPoseClipContinuityQaSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'deterministic-pose-clip-continuity', version: '1.0.0'},
    featureExtractor,
    thresholds: {
      identityConsistency: threshold,
      scaleConsistency: threshold,
      canvasConsistency: threshold,
      bodyProportion: threshold,
      footContact: threshold,
      anchorMovement: threshold,
      silhouetteContinuity: threshold,
      loopClosure: threshold,
    },
  });
  const processorSpecHashes = {
    matted: matted.processorSpecHash,
    normalized: normalized.processorSpecHash,
    anchored: anchored.processorSpecHash,
  };
  const frameExecutionKeys = changes.frameExecutionKeys ?? await Promise.all(request.frames.map((job) => (
    poseFrameExecutionKey({
      frameJobHash: job.frameJobHash,
      processorSpecHashes,
      qaEvaluatorSpecHash: frameQaSpec.qaEvaluatorSpecHash,
      executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
    })
  )));
  return createPoseClipProductionProfile({
    schemaVersion: '1.0.0',
    profileId: 'm4-real-production-profile',
    approval: 'approved',
    processorSpecs: {matted, normalized, anchored},
    frameQaSpec,
    continuityQaSpec,
    executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
    modelHashes: changes.modelHashes ?? RUNTIME_MODELS.map(({modelId, contentHash}) => ({modelId, contentHash})),
    frameExecutionKeys,
  });
}

async function orchestrator(
  profile: PoseClipProductionProfile,
  provider: CountingGenerationProvider,
  mattingProcessor: PoseFrameProcessor = new ChromaKeyPoseFrameMattingProcessor(),
): Promise<PoseClipProductionOrchestrator> {
  const root = await mkdtemp(join(tmpdir(), 'pose-clip-orchestrator-'));
  roots.push(root);
  const cas = new LocalContentAddressedAssetStore(root);
  const resolver = new LocalCasAssetByteResolver(root);
  return new PoseClipProductionOrchestrator({
    trustedProfileHash: profile.profileHash,
    provider,
    rawCas: cas,
    matting: {resolver, cas, processor: mattingProcessor},
    normalization: {resolver, cas, processor: new CanonicalCanvasPoseFrameNormalizer()},
    anchoring: {resolver, cas, processor: new AlphaGeometryPoseFrameAnchorDetector()},
    frameQaEvaluator: new RequiredAnchorPoseFrameQaEvaluator(),
    continuityFeatureExtractor: new RgbaPoseClipContinuityFeatureExtractor(resolver),
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });
}

describe('M4 Commit 6 Trusted Production Orchestrator', () => {
  it('runs one Profile-driven entry through real pixels, Bridge, Continuity and final assembly', async () => {
    const request = await productionRequest();
    const profile = await productionProfile(request);
    const provider = new CountingGenerationProvider();
    const execution = await (await orchestrator(profile, provider)).execute({
      request,
      productionProfile: profile,
      humanReview: 'approved',
    });

    expect(provider.calls).toBe(4);
    expect(execution.frameResults).toHaveLength(4);
    expect(execution.frameResults.map(({artifacts}) => artifacts.map(({stage}) => stage))).toEqual([
      ['raw', 'matted', 'normalized', 'anchored'],
      ['raw', 'matted', 'normalized', 'anchored'],
      ['raw', 'matted', 'normalized', 'anchored'],
      ['raw', 'matted', 'normalized', 'anchored'],
    ]);
    expect(execution.matting.result.processorSpecHash).toBe(profile.processorSpecs.matted.processorSpecHash);
    expect(execution.normalization.result.processorSpecHash).toBe(profile.processorSpecs.normalized.processorSpecHash);
    expect(execution.anchoring.result.processorSpecHash).toBe(profile.processorSpecs.anchored.processorSpecHash);
    expect(execution.continuityEvaluation.continuityQaSpecHash).toBe(
      profile.continuityQaSpec.continuityQaSpecHash,
    );
    expect(execution.result.qa.productionReady).toBe(true);
    await expect(assertPoseClipProductionResultIntegrity(request, execution.result, {
      expectedProfileHash: profile.profileHash,
    })).resolves.toEqual(execution.result);
  });

  it('rejects an untrusted Profile before the generation provider is called', async () => {
    const request = await productionRequest();
    const profile = await productionProfile(request);
    const provider = new CountingGenerationProvider();
    const runner = await orchestrator(profile, provider);
    const untrusted = await productionProfile(request, {
      frameExecutionKeys: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)],
    });

    await expect(runner.execute({
      request,
      productionProfile: untrusted,
      humanReview: 'approved',
    })).rejects.toMatchObject({
      code: 'PRODUCTION_ORCHESTRATOR_PROFILE_NOT_TRUSTED',
    } satisfies Partial<PoseClipProductionOrchestratorError>);
    expect(provider.calls).toBe(0);
  });

  it('rejects detached frameExecutionKeys before the generation provider is called', async () => {
    const request = await productionRequest();
    const profile = await productionProfile(request, {
      frameExecutionKeys: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)],
    });
    const provider = new CountingGenerationProvider();

    await expect((await orchestrator(profile, provider)).execute({
      request,
      productionProfile: profile,
      humanReview: 'approved',
    })).rejects.toMatchObject({
      code: 'PRODUCTION_ORCHESTRATOR_FRAME_EXECUTION_KEY_MISMATCH',
    } satisfies Partial<PoseClipProductionOrchestratorError>);
    expect(provider.calls).toBe(0);
  });

  it('rejects non-admitted generation models before the generation provider is called', async () => {
    const request = await productionRequest();
    const profile = await productionProfile(request, {
      modelHashes: [{modelId: 'unrelated-model', contentHash: 'f'.repeat(64)}],
    });
    const provider = new CountingGenerationProvider();

    await expect((await orchestrator(profile, provider)).execute({
      request,
      productionProfile: profile,
      humanReview: 'approved',
    })).rejects.toMatchObject({
      code: 'PRODUCTION_ORCHESTRATOR_MODEL_NOT_ADMITTED',
    } satisfies Partial<PoseClipProductionOrchestratorError>);
    expect(provider.calls).toBe(0);
  });

  it('rejects a Processor that does not implement the Profile identity before generation', async () => {
    const request = await productionRequest();
    const profile = await productionProfile(request);
    const provider = new CountingGenerationProvider();
    const wrongProcessor = new DeterministicReferencePoseFrameProcessor(
      'matted',
      'not-the-profile-processor',
      '1.0.0',
    );

    await expect((await orchestrator(profile, provider, wrongProcessor)).execute({
      request,
      productionProfile: profile,
      humanReview: 'approved',
    })).rejects.toMatchObject({
      code: 'PRODUCTION_ORCHESTRATOR_PROCESSOR_BINDING_MISMATCH',
    } satisfies Partial<PoseClipProductionOrchestratorError>);
    expect(provider.calls).toBe(0);
  });
});
