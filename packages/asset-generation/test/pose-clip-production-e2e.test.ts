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
  sha256Bytes,
  type PoseAnchors,
  type PoseClipContinuityFrameFeatures,
  type PoseClipFrameJob,
  type PoseFrameProcessorSpec,
} from '@pose-clip/schemas';
import {
  DeterministicPoseClipContinuityEvaluator,
  DeterministicReferenceContinuityFeatureExtractor,
  DeterministicReferencePoseFrameProcessor,
  LocalContentAddressedAssetStore,
  PoseFrameProductionExecutor,
  RequiredAnchorPoseFrameQaEvaluator,
  assemblePoseClipProductionResult,
  type GeneratedImageArtifact,
  type ImageGenerationProvider,
  type PoseFramePipelineStage,
} from '../src/index.js';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1WzWQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);
const ANCHORS: PoseAnchors = {
  foot: {x: 0.5, y: 0.9},
  leftFoot: {x: 0.45, y: 0.9},
  rightFoot: {x: 0.55, y: 0.9},
  center: {x: 0.5, y: 0.5},
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

class FixtureGenerationProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';

  async generate(request: PoseClipFrameJob['generationRequest']): Promise<GeneratedImageArtifact[]> {
    const contentHash = await sha256Bytes(PNG);
    const asset = ProductionVisualAssetSchema.parse({
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
        createdAt: '2026-08-18T00:00:00.000Z',
      },
      qaStatus: 'pending',
      width: 1,
      height: 1,
      alphaMode: 'straight',
    });
    return [{
      bytes: PNG,
      filePath: `virtual://${contentHash}.png`,
      asset,
      providerMetadata: {fixture: true},
    }];
  }
}

async function frameJob(frameIndex: number): Promise<PoseClipFrameJob> {
  const output = {assetId: `rabbit.run-left.${frameIndex + 1}`, kind: 'animal-frame' as const};
  const spec = await createPoseClipFrameSpec({
    frameIndex,
    phase: `phase-${frameIndex}`,
    poseIntent: `Rabbit run phase ${frameIndex + 1}`,
    durationFrames: 3,
    contact: 'both',
    referenceFoot: 'midpoint',
    requiredAnchors: ['foot', 'center', 'leftFoot', 'rightFoot'],
    seed: 4200 + frameIndex,
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
    workflowId: 'production-closure-fixture',
    workflowHash: '1'.repeat(64),
    provider: 'comfyui',
    runtimeModels: [
      {role: 'diffusion-model', modelId: 'flux-2.safetensors', contentHash: '2'.repeat(64)},
      {role: 'text-encoder', modelId: 'qwen.safetensors', contentHash: '3'.repeat(64)},
      {role: 'vae', modelId: 'flux2-vae.safetensors', contentHash: '4'.repeat(64)},
    ],
    prompt: `Whole-body rabbit run phase ${frameIndex + 1}`,
    negativePrompt: 'cropped feet, extra limbs',
    seed: spec.seed,
    referenceAssets: [],
    output: {...output, nodeId: '17', expectedCount: 1},
  });
  return createPoseClipFrameJob({spec, generationRequest});
}

async function pipeline(): Promise<readonly PoseFramePipelineStage[]> {
  const definitions = [
    {
      stage: 'matted' as const,
      processor: {name: 'reference-matting', version: '1.0.0'},
      model: {modelId: 'rmbg-2.0', contentHash: '5'.repeat(64)},
      config: {threshold: 0.5},
    },
    {
      stage: 'normalized' as const,
      processor: {name: 'reference-normalization', version: '1.0.0'},
      config: {canvas: {width: 768, height: 1024}},
    },
    {
      stage: 'anchored' as const,
      processor: {name: 'reference-anchoring', version: '1.0.0'},
      config: {anchors: ANCHORS},
    },
  ];
  const specs: PoseFrameProcessorSpec[] = [];
  for (const definition of definitions) {
    specs.push(await createPoseFrameProcessorSpec({schemaVersion: '1.0.0', ...definition}));
  }
  return specs.map((spec) => ({
    spec,
    processor: new DeterministicReferencePoseFrameProcessor(
      spec.stage,
      spec.processor.name,
      spec.processor.version,
    ),
  }));
}

function feature(
  result: Awaited<ReturnType<PoseFrameProductionExecutor['execute']>>['result'],
): PoseClipContinuityFrameFeatures {
  const asset = result.artifacts[3]!.asset;
  return {
    frameIndex: result.frameIndex,
    sourceContentHash: asset.contentHash,
    canvas: {width: asset.width, height: asset.height},
    subjectBounds: {x: 0.2, y: 0.1, width: 0.6, height: 0.8},
    identityEmbedding: [0.2, 0.4, 0.6],
    bodyProportions: [0.25, 0.5, 0.75],
    silhouetteEmbedding: [0.1, 0.3, 0.5],
  };
}

describe('M3 Commit 3.2.1 Production Closure E2E', () => {
  it('runs four Frame Jobs through Continuity, approved Profile admission and final integrity', async () => {
    const jobs = await Promise.all([0, 1, 2, 3].map(frameJob));
    const request = await createPoseClipProductionRequest({
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
      frames: jobs,
    });
    const stages = await pipeline();
    const frameQaSpec = await createPoseFrameQaEvaluatorSpec({
      schemaVersion: '1.0.0',
      evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
      config: {},
    });
    const root = await mkdtemp(join(tmpdir(), 'pose-clip-production-e2e-'));
    roots.push(root);
    const executor = new PoseFrameProductionExecutor({
      provider: new FixtureGenerationProvider(),
      cas: new LocalContentAddressedAssetStore(root),
      stages,
      qa: {spec: frameQaSpec, evaluator: new RequiredAnchorPoseFrameQaEvaluator()},
    });
    const executions = [];
    for (const job of jobs) executions.push(await executor.execute(job));
    const frameResults = executions.map(({result}) => result);

    const featureExtractor = await createPoseClipContinuityFeatureExtractorSpec({
      schemaVersion: '1.0.0',
      extractor: {name: 'reference-continuity-features', version: '1.0.0'},
      config: {frames: frameResults.map(feature)},
    });
    const threshold = {warning: 0.1, failure: 0.2};
    const continuityQaSpec = await createPoseClipContinuityQaSpec({
      schemaVersion: '1.0.0',
      evaluator: {name: 'deterministic-pose-clip-continuity', version: '1.0.0'},
      featureExtractor,
      thresholds: {
        identityConsistency: threshold,
        scaleConsistency: threshold,
        canvasConsistency: {warning: 0, failure: 0.5},
        bodyProportion: threshold,
        footContact: {warning: 0.02, failure: 0.05},
        anchorMovement: threshold,
        silhouetteContinuity: threshold,
        loopClosure: threshold,
      },
    });
    const continuityEvaluation = await new DeterministicPoseClipContinuityEvaluator(
      new DeterministicReferenceContinuityFeatureExtractor(),
    ).evaluate({frameResults, loop: request.loop, spec: continuityQaSpec});
    const processorSpecs = Object.fromEntries(stages.map(({spec}) => [spec.stage, spec])) as {
      matted: PoseFrameProcessorSpec;
      normalized: PoseFrameProcessorSpec;
      anchored: PoseFrameProcessorSpec;
    };
    const productionProfile = await createPoseClipProductionProfile({
      schemaVersion: '1.0.0',
      profileId: 'test-approved-reference-profile',
      approval: 'approved',
      processorSpecs,
      frameQaSpec,
      continuityQaSpec,
      executor: {name: 'pose-frame-production-executor', version: '0.1.2'},
      modelHashes: [
        ...jobs[0]!.generationRequest.runtimeModels.map(({modelId, contentHash}) => ({modelId, contentHash})),
        {modelId: 'rmbg-2.0', contentHash: '5'.repeat(64)},
      ],
      frameExecutionKeys: frameResults.map(({frameExecutionKey}) => frameExecutionKey),
    });
    const result = await assemblePoseClipProductionResult({
      request,
      frameResults,
      continuityEvaluation,
      productionProfile,
      producer: {name: 'pose-clip-production-assembler', version: '1.0.0'},
      humanReview: 'approved',
    });

    expect(result.qa.productionReady).toBe(true);
    expect(result.productionProfile.profileHash).toBe(productionProfile.profileHash);
    await expect(assertPoseClipProductionResultIntegrity(request, result)).resolves.toEqual(result);
  });
});
