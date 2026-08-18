import {describe, expect, it} from 'vitest';
import {
  contentAddressedAssetUri,
  createActionGenerationRequest,
  createPoseClipFrameJob,
  createPoseClipFrameSpec,
  createPoseClipContinuityFeatureExtractorSpec,
  createPoseClipContinuityQaSpec,
  createPoseClipProductionProfile,
  createPoseClipProductionRequest,
  createPoseFrameProcessorSpec,
  createPoseFrameQaEvaluatorSpec,
  hashPoseClipFrameProductionResultPayload,
  hashPoseFrameArtifactPayload,
  poseFrameExecutionKey,
  sha256Bytes,
  type PoseAnchors,
  type PoseClipContinuityFrameFeatures,
  type PoseClipFrameProductionResult,
  type PoseClipFrameJob,
  type PoseFrameArtifact,
} from '@pose-clip/schemas';
import {
  DeterministicPoseClipContinuityEvaluator,
  DeterministicReferenceContinuityFeatureExtractor,
  assemblePoseClipProductionResult,
} from '../src/index.js';

const PRODUCER = {name: 'continuity-fixture', version: '1.0.0'} as const;
const DEFAULT_ANCHORS: PoseAnchors = {
  foot: {x: 0.5, y: 0.9},
  leftFoot: {x: 0.45, y: 0.9},
  rightFoot: {x: 0.55, y: 0.9},
  center: {x: 0.5, y: 0.5},
};

interface FrameOptions {
  width?: number;
  height?: number;
  anchors?: PoseAnchors;
  contact?: 'left-foot' | 'right-foot' | 'both' | 'none';
  job?: PoseClipFrameJob;
}

async function productionProfileFrameBindings() {
  const [matted, normalized, anchored] = await Promise.all([
    createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0', stage: 'matted',
      processor: {name: 'approved-matting', version: '1.0.0'}, config: {},
    }),
    createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0', stage: 'normalized',
      processor: {name: 'approved-normalization', version: '1.0.0'}, config: {},
    }),
    createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0', stage: 'anchored',
      processor: {name: 'approved-anchoring', version: '1.0.0'}, config: {},
    }),
  ]);
  const frameQaSpec = await createPoseFrameQaEvaluatorSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'approved-frame-qa', version: '1.0.0'},
    config: {},
  });
  return {
    processorSpecs: {matted, normalized, anchored},
    frameQaSpec,
    executor: {name: 'pose-frame-production-executor', version: '0.1.2'} as const,
  };
}

async function productionProfileFrameExecutionKey(frameJobHash: string): Promise<string> {
  const bindings = await productionProfileFrameBindings();
  return poseFrameExecutionKey({
    frameJobHash,
    processorSpecHashes: {
      matted: bindings.processorSpecs.matted.processorSpecHash,
      normalized: bindings.processorSpecs.normalized.processorSpecHash,
      anchored: bindings.processorSpecs.anchored.processorSpecHash,
    },
    qaEvaluatorSpecHash: bindings.frameQaSpec.qaEvaluatorSpecHash,
    executor: bindings.executor,
  });
}

async function frameResult(index: number, options: FrameOptions = {}): Promise<PoseClipFrameProductionResult> {
  const width = options.width ?? 100;
  const height = options.height ?? 200;
  const assetId = options.job?.spec.output.assetId ?? `rabbit.run.${index}`;
  const generationInputHash = options.job?.generationRequest.inputHash
    ?? await sha256Bytes(new TextEncoder().encode(`generation:${index}`));
  const artifacts: PoseFrameArtifact[] = [];
  let inputHash = generationInputHash;
  for (const stage of ['raw', 'matted', 'normalized', 'anchored'] as const) {
    const contentHash = await sha256Bytes(new TextEncoder().encode(`${stage}:${index}:${width}:${height}`));
    const artifactPayload = {
      stage,
      inputHash,
      producer: PRODUCER,
      asset: {
        id: stage === 'anchored' ? assetId : `${assetId}.${stage}`,
        uri: contentAddressedAssetUri(contentHash),
        contentHash,
        source: 'generated' as const,
        provenance: {
          inputHash,
          promptHash: await sha256Bytes(new TextEncoder().encode(`prompt:${index}`)),
          seed: index,
          producer: PRODUCER,
          createdAt: '2026-08-15T00:00:00.000Z',
        },
        qaStatus: 'pending' as const,
        kind: 'animal-frame' as const,
        width,
        height,
        alphaMode: 'straight' as const,
      },
    };
    const artifact = {...artifactPayload, outputHash: await hashPoseFrameArtifactPayload(artifactPayload)};
    artifacts.push(artifact);
    inputHash = artifact.outputHash;
  }
  const frameJobHash = options.job?.frameJobHash
    ?? await sha256Bytes(new TextEncoder().encode(`job:${index}`));
  const payload = {
    schemaVersion: '1.0.0' as const,
    frameExecutionKey: await productionProfileFrameExecutionKey(frameJobHash),
    frameJobHash,
    frameIndex: index,
    frameSpecHash: options.job?.spec.frameSpecHash ?? await sha256Bytes(new TextEncoder().encode(`spec:${index}`)),
    generationInputHash,
    artifacts,
    poseFrame: {
      assetId,
      durationFrames: options.job?.spec.durationFrames ?? 3,
      anchors: options.anchors ?? DEFAULT_ANCHORS,
      contact: {type: options.job?.spec.contact ?? options.contact ?? 'both'},
      referenceFoot: options.job?.spec.referenceFoot ?? 'midpoint' as const,
    },
    qa: {
      structural: 'passed' as const,
      matting: 'passed' as const,
      normalization: 'passed' as const,
      anchors: 'passed' as const,
      productionReady: true,
      diagnostics: [],
    },
  };
  return {...payload, resultHash: await hashPoseClipFrameProductionResultPayload(payload)};
}

function feature(
  result: PoseClipFrameProductionResult,
  overrides: Partial<PoseClipContinuityFrameFeatures> = {},
): PoseClipContinuityFrameFeatures {
  const finalAsset = result.artifacts[3]!.asset;
  return {
    frameIndex: result.frameIndex,
    sourceContentHash: finalAsset.contentHash,
    canvas: {width: finalAsset.width, height: finalAsset.height},
    subjectBounds: {x: 0.2, y: 0.1, width: 0.6, height: 0.8},
    identityEmbedding: [0.2, 0.4, 0.6],
    bodyProportions: [0.25, 0.5, 0.75],
    silhouetteEmbedding: [0.1, 0.3, 0.5],
    ...overrides,
  };
}

async function qaSpec(frames: readonly PoseClipContinuityFrameFeatures[]) {
  const featureExtractor = await createPoseClipContinuityFeatureExtractorSpec({
    schemaVersion: '1.0.0',
    extractor: {name: 'reference-continuity-features', version: '1.0.0'},
    config: {frames},
  });
  return createPoseClipContinuityQaSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'deterministic-pose-clip-continuity', version: '1.0.0'},
    featureExtractor,
    thresholds: {
      identityConsistency: {warning: 0.1, failure: 0.2},
      scaleConsistency: {warning: 0.1, failure: 0.2},
      canvasConsistency: {warning: 0, failure: 0.5},
      bodyProportion: {warning: 0.1, failure: 0.2},
      footContact: {warning: 0.02, failure: 0.05},
      anchorMovement: {warning: 0.1, failure: 0.2},
      silhouetteContinuity: {warning: 0.1, failure: 0.2},
      loopClosure: {warning: 0.1, failure: 0.2},
    },
  });
}

function evaluator(): DeterministicPoseClipContinuityEvaluator {
  return new DeterministicPoseClipContinuityEvaluator(
    new DeterministicReferenceContinuityFeatureExtractor(),
  );
}

async function productionFixture() {
  const jobs: PoseClipFrameJob[] = [];
  for (let index = 0; index < 4; index += 1) {
    const output = {assetId: `rabbit.run.${index}`, kind: 'animal-frame' as const};
    const spec = await createPoseClipFrameSpec({
      frameIndex: index,
      phase: `phase-${index}`,
      poseIntent: `Rabbit run phase ${index}`,
      durationFrames: 3,
      contact: 'both',
      referenceFoot: 'midpoint',
      requiredAnchors: ['foot', 'center', 'leftFoot', 'rightFoot'],
      seed: 4200 + index,
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
      workflowId: 'continuity-fixture',
      workflowHash: '1'.repeat(64),
      provider: 'comfyui',
      runtimeModels: [
        {role: 'diffusion-model', modelId: 'fixture.safetensors', contentHash: '2'.repeat(64)},
        {role: 'text-encoder', modelId: 'fixture-text.safetensors', contentHash: '3'.repeat(64)},
        {role: 'vae', modelId: 'fixture-vae.safetensors', contentHash: '4'.repeat(64)},
      ],
      prompt: `Rabbit run phase ${index}`,
      seed: spec.seed,
      referenceAssets: [],
      output: {...output, nodeId: '17', expectedCount: 1},
    });
    jobs.push(await createPoseClipFrameJob({spec, generationRequest}));
  }
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
  const results = await Promise.all(jobs.map((job, index) => frameResult(index, {job})));
  return {request, results};
}

async function productionProfile(
  request: Awaited<ReturnType<typeof productionFixture>>['request'],
  results: readonly PoseClipFrameProductionResult[],
  continuityQaSpec: Awaited<ReturnType<typeof qaSpec>>,
) {
  const bindings = await productionProfileFrameBindings();
  const runtimeModels = request.frames[0]!.generationRequest.runtimeModels;
  return createPoseClipProductionProfile({
    schemaVersion: '1.0.0',
    profileId: 'rabbit-run-approved-profile',
    approval: 'approved',
    ...bindings,
    continuityQaSpec,
    modelHashes: runtimeModels.map(({modelId, contentHash}) => ({modelId, contentHash})),
    frameExecutionKeys: results.map(({frameExecutionKey}) => frameExecutionKey),
  });
}

describe('M3 PoseClip Continuity QA', () => {
  it('produces deterministic passing evidence across every continuity dimension', async () => {
    const results = await Promise.all([0, 1, 2, 3].map((index) => frameResult(index)));
    const spec = await qaSpec(results.map((result) => feature(result)));
    const first = await evaluator().evaluate({frameResults: results, loop: true, spec});
    const second = await evaluator().evaluate({frameResults: results, loop: true, spec});
    expect(spec.featureExtractor.extractorSpecHash).toBe(
      '7bb9f5977706b80e60f373f4a35cc632368be952d801952e53047fac44bb6650',
    );
    expect(spec.continuityQaSpecHash).toBe(
      '526ac8b4fb54a2ef424da89452bd35c4e388b698baa700e9708d4f4b66bb24bd',
    );
    expect(first.evaluationHash).toBe(
      '42c13e76e6e94dfe8e687fdd974b9fae085bc8d172e9cddb18fdf9df16b798ad',
    );
    expect(first).toEqual(second);
    expect(first.continuity).toBe('passed');
    expect(first.automatedReady).toBe(true);
    expect(Object.values(first.metrics).map(({status}) => status)).toEqual([
      'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed',
    ]);
    expect(first.frameResultHashes).toEqual(results.map(({resultHash}) => resultHash));
    expect(first.continuityQaSpecHash).toBe(spec.continuityQaSpecHash);
  });

  it('marks loop closure not-applicable for a non-loop clip', async () => {
    const results = await Promise.all([0, 1].map((index) => frameResult(index, {contact: 'none'})));
    const evaluation = await evaluator().evaluate({
      frameResults: results,
      loop: false,
      spec: await qaSpec(results.map((result) => feature(result))),
    });
    expect(evaluation.metrics.loopClosure.status).toBe('not-applicable');
    expect(evaluation.metrics.footContact.status).toBe('not-applicable');
    expect(evaluation.continuity).toBe('passed');
  });

  it('detects identity, scale, canvas, body, foot, anchor and silhouette discontinuities', async () => {
    const movedAnchors: PoseAnchors = {
      ...DEFAULT_ANCHORS,
      foot: {x: 0.8, y: 0.7},
      leftFoot: {x: 0.3, y: 0.9},
      rightFoot: {x: 0.4, y: 0.9},
      center: {x: 0.8, y: 0.2},
    };
    const results = [
      await frameResult(0),
      await frameResult(1, {width: 120, anchors: movedAnchors}),
    ];
    const features = [
      feature(results[0]!),
      feature(results[1]!, {
        subjectBounds: {x: 0.1, y: 0.05, width: 0.85, height: 0.9},
        identityEmbedding: [0.8, 1, 1.2],
        bodyProportions: [0.75, 1, 1.25],
        silhouetteEmbedding: [0.7, 0.9, 1.1],
      }),
    ];
    const evaluation = await evaluator().evaluate({
      frameResults: results,
      loop: false,
      spec: await qaSpec(features),
    });
    expect(evaluation.continuity).toBe('failed');
    expect(evaluation.automatedReady).toBe(false);
    for (const metric of [
      'identityConsistency', 'scaleConsistency', 'canvasConsistency', 'bodyProportion',
      'footContact', 'anchorMovement', 'silhouetteContinuity',
    ] as const) expect(evaluation.metrics[metric].status).toBe('failed');
    expect(evaluation.diagnostics.every(({severity}) => severity === 'error')).toBe(true);
  });

  it('binds Reference features into the extractor and QA spec hashes', async () => {
    const results = await Promise.all([0, 1].map((index) => frameResult(index)));
    const baseFeatures = results.map((result) => feature(result));
    const changedFeatures = structuredClone(baseFeatures);
    changedFeatures[1]!.identityEmbedding[0] = 0.21;
    const base = await qaSpec(baseFeatures);
    const changed = await qaSpec(changedFeatures);
    expect(changed.featureExtractor.extractorSpecHash).not.toBe(base.featureExtractor.extractorSpecHash);
    expect(changed.continuityQaSpecHash).not.toBe(base.continuityQaSpecHash);
  });

  it('rejects feature evidence that is not bound to the anchored frame asset', async () => {
    const results = await Promise.all([0, 1].map((index) => frameResult(index)));
    const features = results.map((result) => feature(result));
    features[1] = {...features[1]!, sourceContentHash: 'f'.repeat(64)};
    await expect(evaluator().evaluate({
      frameResults: results,
      loop: false,
      spec: await qaSpec(features),
    })).rejects.toMatchObject({code: 'CONTINUITY_FEATURE_BINDING_MISMATCH'});
  });

  it('rejects duplicate reference features instead of silently selecting the first entry', async () => {
    const results = await Promise.all([0, 1].map((index) => frameResult(index)));
    const features = results.map((result) => feature(result));
    features.push(structuredClone(features[0]!));
    await expect(evaluator().evaluate({
      frameResults: results,
      loop: false,
      spec: await qaSpec(features),
    })).rejects.toMatchObject({code: 'CONTINUITY_REFERENCE_FEATURE_DUPLICATE'});
  });

  it('assembles Continuity Evidence into the canonical Clip Production Result and preserves human review gating', async () => {
    const {request, results} = await productionFixture();
    const continuityQaSpec = await qaSpec(results.map((result) => feature(result)));
    const continuityEvaluation = await evaluator().evaluate({
      frameResults: results,
      loop: request.loop,
      spec: continuityQaSpec,
    });
    const productionProfileSpec = await productionProfile(request, results, continuityQaSpec);
    const approved = await assemblePoseClipProductionResult({
      request,
      frameResults: results,
      continuityEvaluation,
      productionProfile: productionProfileSpec,
      producer: {name: 'pose-clip-production-assembler', version: '1.0.0'},
      humanReview: 'approved',
    });
    expect(approved.qa.productionReady).toBe(true);
    expect(approved.qa.continuity).toBe('passed');
    expect(approved.continuityEvaluation.evaluationHash).toBe(continuityEvaluation.evaluationHash);
    expect(approved.poseClip.frames).toEqual(results.map(({poseFrame}) => poseFrame));

    const pending = await assemblePoseClipProductionResult({
      request,
      frameResults: results,
      continuityEvaluation,
      productionProfile: productionProfileSpec,
      producer: {name: 'pose-clip-production-assembler', version: '1.0.0'},
      humanReview: 'pending',
    });
    expect(pending.qa.productionReady).toBe(false);
    expect(pending.qa.continuity).toBe('passed');
  });
});
