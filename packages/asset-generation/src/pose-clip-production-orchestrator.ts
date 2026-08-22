import {
  assertPoseClipProductionProfileIntegrity,
  assertPoseClipRawGenerationRequestIntegrity,
  poseFrameExecutionKey,
  productionProfileAdmitsModel,
  type PoseClipContinuityEvaluation,
  type PoseClipFrameProductionResult,
  type PoseClipProductionProfile,
  type PoseClipProductionRequest,
  type PoseClipProductionResult,
  type PoseClipRawGenerationRequest,
  type PoseFrameProcessorSpec,
} from '@pose-clip/schemas';
import {
  POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  type PoseFrameQaEvaluator,
} from './frame-production-executor.js';
import type {ContentAddressedAssetStore} from './local-cas-store.js';
import {
  InMemoryPoseFrameGenerationCache,
  InMemoryPoseFrameGenerationResumeCache,
  InMemoryPoseFrameStageCache,
  type PoseFrameGenerationCache,
  type PoseFrameGenerationResumeCache,
  type PoseFrameStageCache,
} from './pose-frame-cache.js';
import type {PoseFrameProcessor} from './pose-frame-processor.js';
import type {PoseFrameNormalizer} from './pose-frame-normalizer.js';
import {
  DeterministicPoseClipContinuityEvaluator,
  type PoseClipContinuityFeatureExtractor,
} from './pose-clip-continuity-evaluator.js';
import {
  PoseClipAnchoringExecutor,
  type PoseClipAnchoringAssetByteResolver,
  type PoseClipAnchoringExecution,
} from './pose-clip-anchoring-executor.js';
import {
  PoseClipFrameProductionBridge,
} from './pose-clip-frame-production-bridge.js';
import {
  PoseClipMattingExecutor,
  type PoseClipMattingAssetByteResolver,
  type PoseClipMattingExecution,
} from './pose-clip-matting-executor.js';
import {
  PoseClipNormalizationExecutor,
  type PoseClipNormalizationAssetByteResolver,
  type PoseClipNormalizationExecution,
} from './pose-clip-normalization-executor.js';
import {
  POSE_CLIP_PRODUCTION_ASSEMBLER_IDENTITY,
  assemblePoseClipProductionResult,
} from './pose-clip-production-assembler.js';
import {
  PoseClipRawGenerationExecutor,
  type PoseClipRawGenerationExecution,
} from './pose-clip-raw-generation-executor.js';
import type {ImageGenerationProvider} from './provider.js';

interface StageRuntime<TResolver, TProcessor> {
  readonly resolver: TResolver;
  readonly cas: ContentAddressedAssetStore;
  readonly processor: TProcessor;
  readonly cache?: PoseFrameStageCache;
}

export interface PoseClipProductionOrchestratorOptions {
  readonly trustedProfileHash: string;
  readonly provider: ImageGenerationProvider;
  readonly rawCas: ContentAddressedAssetStore;
  readonly matting: StageRuntime<PoseClipMattingAssetByteResolver, PoseFrameProcessor>;
  readonly normalization: StageRuntime<PoseClipNormalizationAssetByteResolver, PoseFrameNormalizer>;
  readonly anchoring: StageRuntime<PoseClipAnchoringAssetByteResolver, PoseFrameProcessor>;
  readonly frameQaEvaluator: PoseFrameQaEvaluator;
  readonly continuityFeatureExtractor: PoseClipContinuityFeatureExtractor;
  readonly generationCache?: PoseFrameGenerationCache;
  readonly generationResumeCache?: PoseFrameGenerationResumeCache;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export interface PoseClipProductionOrchestratorInput {
  readonly request: PoseClipProductionRequest;
  readonly productionProfile: PoseClipProductionProfile;
  readonly humanReview: 'pending' | 'approved' | 'rejected';
}

export interface PoseClipProductionExecution {
  readonly raw: PoseClipRawGenerationExecution;
  readonly matting: PoseClipMattingExecution;
  readonly normalization: PoseClipNormalizationExecution;
  readonly anchoring: PoseClipAnchoringExecution;
  readonly frameResults: readonly PoseClipFrameProductionResult[];
  readonly continuityEvaluation: PoseClipContinuityEvaluation;
  readonly result: PoseClipProductionResult;
  readonly timingsMs: {
    readonly preflight: number;
    readonly raw: number;
    readonly matting: number;
    readonly normalization: number;
    readonly anchoring: number;
    readonly bridge: number;
    readonly continuity: number;
    readonly assembly: number;
    readonly total: number;
  };
}

export class PoseClipProductionOrchestratorError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseClipProductionOrchestratorError';
  }
}

function assertIdentity(
  actual: {readonly id: string; readonly version: string},
  expected: {readonly name: string; readonly version: string},
  code: string,
  label: string,
): void {
  if (actual.id !== expected.name || actual.version !== expected.version) {
    throw new PoseClipProductionOrchestratorError(
      code,
      `${label}: expected ${expected.name}@${expected.version}, received ${actual.id}@${actual.version}`,
    );
  }
}

function assertProcessorBinding(
  processor: PoseFrameProcessor,
  spec: PoseFrameProcessorSpec,
  stage: 'matted' | 'normalized' | 'anchored',
): void {
  if (
    processor.stage !== stage
    || processor.id !== spec.processor.name
    || processor.version !== spec.processor.version
  ) throw new PoseClipProductionOrchestratorError(
    'PRODUCTION_ORCHESTRATOR_PROCESSOR_BINDING_MISMATCH',
    `${stage}: expected ${spec.processor.name}@${spec.processor.version}`,
  );
}

/** Runs the complete M4 production chain only after fail-closed Profile admission. */
export class PoseClipProductionOrchestrator {
  readonly #generationCache: PoseFrameGenerationCache;
  readonly #generationResumeCache: PoseFrameGenerationResumeCache;
  readonly #mattingCache: PoseFrameStageCache;
  readonly #normalizationCache: PoseFrameStageCache;
  readonly #anchoringCache: PoseFrameStageCache;
  readonly #continuityEvaluator: DeterministicPoseClipContinuityEvaluator;

  constructor(private readonly options: PoseClipProductionOrchestratorOptions) {
    this.#generationCache = options.generationCache ?? new InMemoryPoseFrameGenerationCache();
    this.#generationResumeCache = options.generationResumeCache ?? new InMemoryPoseFrameGenerationResumeCache();
    this.#mattingCache = options.matting.cache ?? new InMemoryPoseFrameStageCache();
    this.#normalizationCache = options.normalization.cache ?? new InMemoryPoseFrameStageCache();
    this.#anchoringCache = options.anchoring.cache ?? new InMemoryPoseFrameStageCache();
    this.#continuityEvaluator = new DeterministicPoseClipContinuityEvaluator(
      options.continuityFeatureExtractor,
    );
  }

  async #preflight(
    requestInput: PoseClipProductionRequest,
    profileInput: PoseClipProductionProfile,
  ): Promise<{request: PoseClipRawGenerationRequest; profile: PoseClipProductionProfile}> {
    const [request, profile] = await Promise.all([
      assertPoseClipRawGenerationRequestIntegrity(requestInput),
      assertPoseClipProductionProfileIntegrity(profileInput),
    ]);
    if (profile.profileHash !== this.options.trustedProfileHash) {
      throw new PoseClipProductionOrchestratorError(
        'PRODUCTION_ORCHESTRATOR_PROFILE_NOT_TRUSTED',
        profile.profileId,
      );
    }
    if (
      profile.executor.name !== POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY.name
      || profile.executor.version !== POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY.version
    ) throw new PoseClipProductionOrchestratorError(
      'PRODUCTION_ORCHESTRATOR_EXECUTOR_BINDING_MISMATCH',
      `Expected ${POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY.name}@${POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY.version}`,
    );
    if (profile.frameExecutionKeys.length !== request.frames.length) {
      throw new PoseClipProductionOrchestratorError(
        'PRODUCTION_ORCHESTRATOR_FRAME_COUNT_MISMATCH',
        `Expected ${request.frames.length}, received ${profile.frameExecutionKeys.length}`,
      );
    }
    for (const [frameIndex, job] of request.frames.entries()) {
      if (job.generationRequest.provider !== this.options.provider.id) {
        throw new PoseClipProductionOrchestratorError(
          'PRODUCTION_ORCHESTRATOR_PROVIDER_BINDING_MISMATCH',
          `Frame ${frameIndex}: expected ${job.generationRequest.provider}, received ${this.options.provider.id}`,
        );
      }
      for (const model of job.generationRequest.runtimeModels) {
        if (!productionProfileAdmitsModel(profile, model)) throw new PoseClipProductionOrchestratorError(
          'PRODUCTION_ORCHESTRATOR_MODEL_NOT_ADMITTED',
          `Frame ${frameIndex}: ${model.role}:${model.modelId}`,
        );
      }
      const expectedKey = await poseFrameExecutionKey({
        frameJobHash: job.frameJobHash,
        processorSpecHashes: {
          matted: profile.processorSpecs.matted.processorSpecHash,
          normalized: profile.processorSpecs.normalized.processorSpecHash,
          anchored: profile.processorSpecs.anchored.processorSpecHash,
        },
        qaEvaluatorSpecHash: profile.frameQaSpec.qaEvaluatorSpecHash,
        executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
      });
      if (profile.frameExecutionKeys[frameIndex] !== expectedKey) {
        throw new PoseClipProductionOrchestratorError(
          'PRODUCTION_ORCHESTRATOR_FRAME_EXECUTION_KEY_MISMATCH',
          `Frame ${frameIndex}`,
        );
      }
    }

    assertProcessorBinding(this.options.matting.processor, profile.processorSpecs.matted, 'matted');
    assertProcessorBinding(this.options.normalization.processor, profile.processorSpecs.normalized, 'normalized');
    assertProcessorBinding(this.options.anchoring.processor, profile.processorSpecs.anchored, 'anchored');
    assertIdentity(
      this.options.frameQaEvaluator,
      profile.frameQaSpec.evaluator,
      'PRODUCTION_ORCHESTRATOR_FRAME_QA_BINDING_MISMATCH',
      'Frame QA',
    );
    assertIdentity(
      this.#continuityEvaluator,
      profile.continuityQaSpec.evaluator,
      'PRODUCTION_ORCHESTRATOR_CONTINUITY_EVALUATOR_BINDING_MISMATCH',
      'Continuity Evaluator',
    );
    assertIdentity(
      this.options.continuityFeatureExtractor,
      profile.continuityQaSpec.featureExtractor.extractor,
      'PRODUCTION_ORCHESTRATOR_CONTINUITY_EXTRACTOR_BINDING_MISMATCH',
      'Continuity Feature Extractor',
    );
    return {request, profile};
  }

  async execute(input: PoseClipProductionOrchestratorInput): Promise<PoseClipProductionExecution> {
    const totalStartedAt = performance.now();
    let stageStartedAt = totalStartedAt;
    const {request, profile} = await this.#preflight(input.request, input.productionProfile);
    const preflight = performance.now() - stageStartedAt;
    const attemptOptions = this.options.maxAttempts === undefined ? {} : {maxAttempts: this.options.maxAttempts};
    const timeOptions = this.options.now === undefined ? {} : {now: this.options.now};

    stageStartedAt = performance.now();
    const raw = await new PoseClipRawGenerationExecutor({
      provider: this.options.provider,
      cas: this.options.rawCas,
      generationCache: this.#generationCache,
      generationResumeCache: this.#generationResumeCache,
      ...attemptOptions,
    }).execute(request);
    const rawElapsed = performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const matting = await new PoseClipMattingExecutor({
      resolver: this.options.matting.resolver,
      cas: this.options.matting.cas,
      spec: profile.processorSpecs.matted,
      processor: this.options.matting.processor,
      stageCache: this.#mattingCache,
      ...attemptOptions,
      ...timeOptions,
    }).execute(request, raw.result);
    const mattingElapsed = performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const normalization = await new PoseClipNormalizationExecutor({
      resolver: this.options.normalization.resolver,
      cas: this.options.normalization.cas,
      mattingSpec: profile.processorSpecs.matted,
      spec: profile.processorSpecs.normalized,
      processor: this.options.normalization.processor,
      stageCache: this.#normalizationCache,
      ...attemptOptions,
      ...timeOptions,
    }).execute(request, raw.result, matting.result);
    const normalizationElapsed = performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const anchoring = await new PoseClipAnchoringExecutor({
      resolver: this.options.anchoring.resolver,
      cas: this.options.anchoring.cas,
      mattingSpec: profile.processorSpecs.matted,
      normalizationSpec: profile.processorSpecs.normalized,
      spec: profile.processorSpecs.anchored,
      processor: this.options.anchoring.processor,
      stageCache: this.#anchoringCache,
      ...attemptOptions,
      ...timeOptions,
    }).execute(request, raw.result, matting.result, normalization.result);
    const anchoringElapsed = performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const {frameResults} = await new PoseClipFrameProductionBridge({
      mattingSpec: profile.processorSpecs.matted,
      normalizationSpec: profile.processorSpecs.normalized,
      anchoringSpec: profile.processorSpecs.anchored,
      qa: {spec: profile.frameQaSpec, evaluator: this.options.frameQaEvaluator},
    }).execute({
      request,
      rawResult: raw.result,
      mattingResult: matting.result,
      normalizationResult: normalization.result,
      anchoringResult: anchoring.result,
    });
    const bridge = performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const continuityEvaluation = await this.#continuityEvaluator.evaluate({
      frameResults,
      loop: request.loop,
      spec: profile.continuityQaSpec,
    });
    const continuity = performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const result = await assemblePoseClipProductionResult({
      request,
      frameResults,
      continuityEvaluation,
      productionProfile: profile,
      trustedProfileHash: this.options.trustedProfileHash,
      producer: POSE_CLIP_PRODUCTION_ASSEMBLER_IDENTITY,
      humanReview: input.humanReview,
    });
    const assembly = performance.now() - stageStartedAt;
    return {
      raw,
      matting,
      normalization,
      anchoring,
      frameResults,
      continuityEvaluation,
      result,
      timingsMs: {
        preflight,
        raw: rawElapsed,
        matting: mattingElapsed,
        normalization: normalizationElapsed,
        anchoring: anchoringElapsed,
        bridge,
        continuity,
        assembly,
        total: performance.now() - totalStartedAt,
      },
    };
  }
}
