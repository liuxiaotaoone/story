import {
  ProductionVisualAssetSchema,
  assertPoseClipFrameJobIntegrity,
  assertPoseClipFrameProductionResultIntegrity,
  assertPoseFrameProcessorSpecIntegrity,
  assertPoseFrameQaEvaluatorSpecIntegrity,
  createPoseFrameQaEvaluatorSpec,
  hashPoseClipFrameProductionResultPayload,
  hashPoseFrameArtifactPayload,
  poseFrameExecutionKey,
  poseFrameStageCacheKey,
  sha256Bytes,
  type PoseAnchors,
  type PoseClipFrameJob,
  type PoseClipFrameProductionResult,
  type PoseFrameArtifact,
  type PoseFrameProcessStage,
  type PoseFrameProcessorSpec,
  type PoseFrameProductionQa,
  type PoseFrameQaEvaluatorSpec,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import {inspectPng} from './png.js';
import {
  InMemoryPoseFrameGenerationCache,
  InMemoryPoseFrameResultCache,
  InMemoryPoseFrameStageCache,
  type CachedPoseFrameStageOutput,
  type PoseFrameGenerationCache,
  type PoseFrameResultCache,
  type PoseFrameStageCache,
} from './pose-frame-cache.js';
import {
  PoseFrameProcessorTransientError,
  type PoseFrameProcessor,
} from './pose-frame-processor.js';
import type {GeneratedImageArtifact, ImageGenerationProvider} from './provider.js';
import type {ContentAddressedAssetStore} from './local-cas-store.js';
import {AssetGenerationTransientError} from './integrity.js';

const PROCESS_STAGES = ['matted', 'normalized', 'anchored'] as const;
const EXECUTOR_PRODUCER = {name: 'pose-frame-production-executor', version: '0.1.1'} as const;

export type FrameProductionCacheStatus = 'hit' | 'miss' | 'covered-by-frame-result';

export interface PoseFramePipelineStage {
  readonly spec: PoseFrameProcessorSpec;
  readonly processor: PoseFrameProcessor;
}

export interface PoseFrameQaEvaluatorInput {
  readonly frameJob: PoseClipFrameJob;
  readonly artifacts: readonly PoseFrameArtifact[];
  readonly anchors: PoseAnchors;
  readonly spec: PoseFrameQaEvaluatorSpec;
}

export interface PoseFrameQaEvaluator {
  readonly id: string;
  readonly version: string;
  evaluate(input: PoseFrameQaEvaluatorInput): Promise<PoseFrameProductionQa>;
}

export interface PoseFrameQaBinding {
  readonly spec: PoseFrameQaEvaluatorSpec;
  readonly evaluator: PoseFrameQaEvaluator;
}

export class RequiredAnchorPoseFrameQaEvaluator implements PoseFrameQaEvaluator {
  readonly id = 'required-anchor-frame-qa';
  readonly version = '1.0.0';

  async evaluate(input: PoseFrameQaEvaluatorInput): Promise<PoseFrameProductionQa> {
    const missing = input.frameJob.spec.requiredAnchors.filter((requirement) => {
      if (requirement.startsWith('auxiliary:')) {
        return input.anchors.auxiliary?.[requirement.slice('auxiliary:'.length)] === undefined;
      }
      const direct = requirement as Exclude<keyof PoseAnchors, 'auxiliary'>;
      return input.anchors[direct] === undefined;
    });
    const anchorsPassed = missing.length === 0;
    return {
      structural: 'passed',
      matting: 'passed',
      normalization: 'passed',
      anchors: anchorsPassed ? 'passed' : 'failed',
      productionReady: anchorsPassed,
      diagnostics: missing.map((anchor) => ({
        code: 'FRAME_REQUIRED_ANCHOR_MISSING',
        severity: 'error' as const,
        message: `Required anchor ${anchor} is missing`,
        frameIndex: input.frameJob.spec.frameIndex,
        stage: 'anchored',
      })),
    };
  }
}

export interface FrameProductionStepReport {
  readonly cache: FrameProductionCacheStatus;
  readonly attempts: number;
  readonly cacheKey: string;
  readonly processorSpecHash?: string;
}

export interface PoseFrameProductionExecution {
  readonly frameExecutionKey: string;
  readonly resultCache: 'hit' | 'miss';
  readonly generation: FrameProductionStepReport;
  readonly stages: readonly FrameProductionStepReport[];
  readonly result: PoseClipFrameProductionResult;
}

export interface PoseFrameProductionExecutorOptions {
  readonly provider: ImageGenerationProvider;
  readonly cas: ContentAddressedAssetStore;
  readonly stages: readonly PoseFramePipelineStage[];
  readonly generationCache?: PoseFrameGenerationCache;
  readonly stageCache?: PoseFrameStageCache;
  readonly resultCache?: PoseFrameResultCache;
  readonly qa?: PoseFrameQaBinding;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export class PoseFrameProductionExecutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseFrameProductionExecutionError';
  }
}

export function isRetryableProductionError(error: unknown): boolean {
  return error instanceof AssetGenerationTransientError
    || error instanceof PoseFrameProcessorTransientError;
}

interface AttemptResult<T> {
  value: T;
  attempts: number;
}

async function retry<T>(
  label: string,
  maxAttempts: number,
  operation: () => Promise<T>,
): Promise<AttemptResult<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {value: await operation(), attempts: attempt};
    } catch (error) {
      if (!isRetryableProductionError(error)) throw error;
      lastError = error;
    }
  }
  throw new PoseFrameProductionExecutionError(
    'FRAME_PRODUCTION_RETRY_EXHAUSTED',
    `${label} failed after ${maxAttempts} attempts`,
    {cause: lastError},
  );
}

async function assertBytesIdentity(bytes: Uint8Array, contentHash: string, context: string): Promise<void> {
  if (await sha256Bytes(bytes) !== contentHash) throw new PoseFrameProductionExecutionError(
    'FRAME_PRODUCTION_CONTENT_HASH_MISMATCH', context,
  );
}

function assertPngMetadata(bytes: Uint8Array, asset: VisualAssetRecord, context: string): void {
  let metadata: ReturnType<typeof inspectPng>;
  try {
    metadata = inspectPng(bytes);
  } catch (error) {
    throw new PoseFrameProductionExecutionError('FRAME_PRODUCTION_PNG_INVALID', context, {cause: error});
  }
  if (
    metadata.width !== asset.width
    || metadata.height !== asset.height
    || metadata.alphaMode !== asset.alphaMode
  ) throw new PoseFrameProductionExecutionError('FRAME_PRODUCTION_PNG_METADATA_MISMATCH', context);
}

export class PoseFrameProductionExecutor {
  readonly #generationCache: PoseFrameGenerationCache;
  readonly #stageCache: PoseFrameStageCache;
  readonly #resultCache: PoseFrameResultCache;
  readonly #maxAttempts: number;

  constructor(private readonly options: PoseFrameProductionExecutorOptions) {
    this.#generationCache = options.generationCache ?? new InMemoryPoseFrameGenerationCache();
    this.#stageCache = options.stageCache ?? new InMemoryPoseFrameStageCache();
    this.#resultCache = options.resultCache ?? new InMemoryPoseFrameResultCache();
    this.#maxAttempts = options.maxAttempts ?? 2;
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts <= 0) {
      throw new TypeError('Frame production maxAttempts must be a positive integer');
    }
  }

  async #prepareQa(): Promise<PoseFrameQaBinding> {
    const binding = this.options.qa ?? {
      spec: await createPoseFrameQaEvaluatorSpec({
        schemaVersion: '1.0.0',
        evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
        config: {},
      }),
      evaluator: new RequiredAnchorPoseFrameQaEvaluator(),
    };
    const spec = await assertPoseFrameQaEvaluatorSpecIntegrity(binding.spec);
    if (
      binding.evaluator.id !== spec.evaluator.name
      || binding.evaluator.version !== spec.evaluator.version
    ) throw new PoseFrameProductionExecutionError(
      'FRAME_QA_EVALUATOR_BINDING_INVALID',
      `Expected ${spec.evaluator.name}@${spec.evaluator.version}`,
    );
    return {spec, evaluator: binding.evaluator};
  }

  async #prepareStages(): Promise<readonly PoseFramePipelineStage[]> {
    if (this.options.stages.length !== PROCESS_STAGES.length) {
      throw new PoseFrameProductionExecutionError('FRAME_PROCESSOR_PIPELINE_INVALID', 'Expected three processing stages');
    }
    const stages: PoseFramePipelineStage[] = [];
    for (const [index, expectedStage] of PROCESS_STAGES.entries()) {
      const entry = this.options.stages[index];
      if (entry === undefined) throw new PoseFrameProductionExecutionError(
        'FRAME_PROCESSOR_PIPELINE_INVALID', `Missing ${expectedStage} processor`,
      );
      const spec = await assertPoseFrameProcessorSpecIntegrity(entry.spec);
      if (
        spec.stage !== expectedStage
        || entry.processor.stage !== expectedStage
        || entry.processor.id !== spec.processor.name
        || entry.processor.version !== spec.processor.version
      ) throw new PoseFrameProductionExecutionError(
        'FRAME_PROCESSOR_PIPELINE_INVALID', `Processor binding mismatch at ${expectedStage}`,
      );
      stages.push({spec, processor: entry.processor});
    }
    return stages;
  }

  async #frameExecutionKey(
    frameJob: PoseClipFrameJob,
    stages: readonly PoseFramePipelineStage[],
    qa: PoseFrameQaBinding,
  ): Promise<string> {
    const specHashes = Object.fromEntries(stages.map(({spec}) => [spec.stage, spec.processorSpecHash]));
    return poseFrameExecutionKey({
      frameJobHash: frameJob.frameJobHash,
      processorSpecHashes: specHashes,
      qaEvaluatorSpecHash: qa.spec.qaEvaluatorSpecHash,
      executor: EXECUTOR_PRODUCER,
    });
  }

  async #validatedGeneratedArtifact(
    frameJob: PoseClipFrameJob,
    input: GeneratedImageArtifact,
  ): Promise<GeneratedImageArtifact> {
    const parsed = ProductionVisualAssetSchema.safeParse(input.asset);
    if (!parsed.success) throw new PoseFrameProductionExecutionError(
      'RAW_GENERATION_ASSET_INVALID', `Frame ${frameJob.spec.frameIndex}`, {cause: parsed.error},
    );
    const asset = parsed.data;
    if (
      asset.id !== frameJob.spec.output.assetId
      || asset.kind !== frameJob.spec.output.kind
      || asset.source !== 'generated'
      || asset.provenance?.inputHash !== frameJob.generationRequest.inputHash
    ) throw new PoseFrameProductionExecutionError(
      'RAW_GENERATION_BINDING_MISMATCH', `Frame ${frameJob.spec.frameIndex}`,
    );
    await assertBytesIdentity(input.bytes, asset.contentHash, `Raw frame ${frameJob.spec.frameIndex}`);
    assertPngMetadata(input.bytes, asset, `Raw frame ${frameJob.spec.frameIndex}`);
    const stored = await this.options.cas.putPng(input.bytes);
    if (stored.contentHash !== asset.contentHash || stored.uri !== asset.uri) throw new PoseFrameProductionExecutionError(
      'RAW_CAS_BINDING_MISMATCH', `Frame ${frameJob.spec.frameIndex}`,
    );
    return {
      bytes: stored.bytes,
      filePath: stored.filePath,
      asset,
      providerMetadata: structuredClone(input.providerMetadata),
    };
  }

  async #generate(frameJob: PoseClipFrameJob): Promise<{
    artifact: GeneratedImageArtifact;
    report: FrameProductionStepReport;
  }> {
    if (this.options.provider.id !== frameJob.generationRequest.provider) {
      throw new PoseFrameProductionExecutionError(
        'GENERATION_PROVIDER_MISMATCH',
        `Expected ${frameJob.generationRequest.provider}, received ${this.options.provider.id}`,
      );
    }
    const cacheKey = frameJob.generationRequest.inputHash;
    const cached = await this.#generationCache.get(cacheKey);
    if (cached !== undefined) return {
      artifact: await this.#validatedGeneratedArtifact(frameJob, cached),
      report: {cache: 'hit', attempts: 0, cacheKey},
    };
    const generated = await retry(`generation frame ${frameJob.spec.frameIndex}`, this.#maxAttempts, async () => {
      const outputs = await this.options.provider.generate(frameJob.generationRequest);
      if (outputs.length !== 1 || outputs[0] === undefined) throw new PoseFrameProductionExecutionError(
        'RAW_GENERATION_OUTPUT_COUNT_MISMATCH', `Frame ${frameJob.spec.frameIndex}`,
      );
      return this.#validatedGeneratedArtifact(frameJob, outputs[0]);
    });
    await this.#generationCache.set(cacheKey, generated.value);
    return {
      artifact: generated.value,
      report: {cache: 'miss', attempts: generated.attempts, cacheKey},
    };
  }

  async #rawEvidence(frameJob: PoseClipFrameJob, generated: GeneratedImageArtifact): Promise<PoseFrameArtifact> {
    const producer = generated.asset.provenance?.producer;
    if (producer === undefined) throw new PoseFrameProductionExecutionError(
      'RAW_GENERATION_PROVENANCE_MISSING', `Frame ${frameJob.spec.frameIndex}`,
    );
    const payload = {
      stage: 'raw' as const,
      inputHash: frameJob.generationRequest.inputHash,
      producer,
      asset: generated.asset,
    };
    return {...payload, outputHash: await hashPoseFrameArtifactPayload(payload)};
  }

  async #validatedCachedStageOutput(
    output: CachedPoseFrameStageOutput,
    context: string,
  ): Promise<CachedPoseFrameStageOutput> {
    await assertBytesIdentity(output.bytes, output.contentHash, context);
    const metadata = inspectPng(output.bytes);
    if (
      metadata.width !== output.width
      || metadata.height !== output.height
      || metadata.alphaMode !== output.alphaMode
    ) throw new PoseFrameProductionExecutionError('FRAME_STAGE_CACHE_METADATA_MISMATCH', context);
    return output;
  }

  async #processStage(
    frameJob: PoseClipFrameJob,
    entry: PoseFramePipelineStage,
    input: {bytes: Uint8Array; asset: VisualAssetRecord},
    previousArtifactHash: string,
  ): Promise<{
    artifact: PoseFrameArtifact;
    bytes: Uint8Array;
    anchors?: PoseAnchors;
    report: FrameProductionStepReport;
  }> {
    const stage = entry.spec.stage;
    const cacheKey = await poseFrameStageCacheKey({
      stage,
      inputContentHash: input.asset.contentHash,
      processorSpecHash: entry.spec.processorSpecHash,
    });
    let cached = await this.#stageCache.get(cacheKey);
    let cache: FrameProductionCacheStatus = 'hit';
    let attempts = 0;
    if (cached === undefined) {
      cache = 'miss';
      const processed = await retry(`${stage} frame ${frameJob.spec.frameIndex}`, this.#maxAttempts, () => (
        entry.processor.process({
          bytes: input.bytes,
          inputContentHash: input.asset.contentHash,
          spec: entry.spec,
        })
      ));
      attempts = processed.attempts;
      if (stage === 'anchored' && processed.value.anchors === undefined) {
        throw new PoseFrameProductionExecutionError(
          'ANCHOR_PROCESSOR_OUTPUT_MISSING', `Frame ${frameJob.spec.frameIndex}`,
        );
      }
      if (stage !== 'anchored' && processed.value.anchors !== undefined) {
        throw new PoseFrameProductionExecutionError(
          'UNEXPECTED_PROCESSOR_ANCHORS', `${stage} frame ${frameJob.spec.frameIndex}`,
        );
      }
      const metadata = inspectPng(processed.value.bytes);
      const stored = await this.options.cas.putPng(processed.value.bytes);
      cached = {
        bytes: stored.bytes,
        contentHash: stored.contentHash,
        ...metadata,
        createdAt: (this.options.now ?? (() => new Date()))().toISOString(),
        ...(processed.value.anchors === undefined ? {} : {anchors: structuredClone(processed.value.anchors)}),
      };
      await this.#stageCache.set(cacheKey, cached);
    }
    const output = await this.#validatedCachedStageOutput(cached, `${stage} frame ${frameJob.spec.frameIndex}`);
    if (stage === 'anchored' && output.anchors === undefined) throw new PoseFrameProductionExecutionError(
      'ANCHOR_PROCESSOR_OUTPUT_MISSING', `Cached frame ${frameJob.spec.frameIndex}`,
    );
    if (stage !== 'anchored' && output.anchors !== undefined) throw new PoseFrameProductionExecutionError(
      'UNEXPECTED_PROCESSOR_ANCHORS', `Cached ${stage} frame ${frameJob.spec.frameIndex}`,
    );
    const stored = await this.options.cas.putPng(output.bytes);
    const finalStage = stage === 'anchored';
    const asset = ProductionVisualAssetSchema.parse({
      id: finalStage ? frameJob.spec.output.assetId : `${frameJob.spec.output.assetId}.${stage}`,
      uri: stored.uri,
      contentHash: stored.contentHash,
      source: 'generated',
      provenance: {
        inputHash: cacheKey,
        ...(entry.spec.model === undefined ? {} : {modelId: entry.spec.model.modelId}),
        producer: entry.spec.processor,
        createdAt: output.createdAt,
      },
      qaStatus: 'pending',
      kind: frameJob.spec.output.kind,
      width: output.width,
      height: output.height,
      alphaMode: output.alphaMode,
    });
    const artifactPayload = {
      stage,
      inputHash: previousArtifactHash,
      producer: entry.spec.processor,
      asset,
    };
    const artifact = {
      ...artifactPayload,
      outputHash: await hashPoseFrameArtifactPayload(artifactPayload),
    };
    return {
      artifact,
      bytes: stored.bytes,
      ...(output.anchors === undefined ? {} : {anchors: structuredClone(output.anchors)}),
      report: {cache, attempts, cacheKey, processorSpecHash: entry.spec.processorSpecHash},
    };
  }

  async execute(input: PoseClipFrameJob): Promise<PoseFrameProductionExecution> {
    const frameJob = await assertPoseClipFrameJobIntegrity(input);
    const stages = await this.#prepareStages();
    const qaBinding = await this.#prepareQa();
    const frameExecutionKey = await this.#frameExecutionKey(frameJob, stages, qaBinding);
    const cachedResult = await this.#resultCache.get(frameExecutionKey);
    if (cachedResult !== undefined) {
      const result = await assertPoseClipFrameProductionResultIntegrity(frameJob, cachedResult);
      const coveredStages = await Promise.all(stages.map(async ({spec}, index) => ({
        cache: 'covered-by-frame-result' as const,
        attempts: 0,
        cacheKey: await poseFrameStageCacheKey({
          stage: spec.stage,
          inputContentHash: result.artifacts[index]!.asset.contentHash,
          processorSpecHash: spec.processorSpecHash,
        }),
        processorSpecHash: spec.processorSpecHash,
      })));
      return {
        frameExecutionKey,
        resultCache: 'hit',
        generation: {
          cache: 'covered-by-frame-result', attempts: 0,
          cacheKey: frameJob.generationRequest.inputHash,
        },
        stages: coveredStages,
        result,
      };
    }

    const generated = await this.#generate(frameJob);
    const artifacts: PoseFrameArtifact[] = [await this.#rawEvidence(frameJob, generated.artifact)];
    const stageReports: FrameProductionStepReport[] = [];
    let current = {bytes: generated.artifact.bytes, asset: generated.artifact.asset};
    let anchors: PoseAnchors | undefined;
    for (const entry of stages) {
      const processed = await this.#processStage(
        frameJob,
        entry,
        current,
        artifacts.at(-1)!.outputHash,
      );
      artifacts.push(processed.artifact);
      stageReports.push(processed.report);
      current = {bytes: processed.bytes, asset: processed.artifact.asset};
      if (processed.anchors !== undefined) anchors = processed.anchors;
    }
    if (anchors === undefined) throw new PoseFrameProductionExecutionError(
      'ANCHOR_PROCESSOR_OUTPUT_MISSING', `Frame ${frameJob.spec.frameIndex}`,
    );
    const qa = await qaBinding.evaluator.evaluate({
      frameJob,
      artifacts,
      anchors,
      spec: qaBinding.spec,
    });
    const framePayload = {
      schemaVersion: '1.0.0' as const,
      frameJobHash: frameJob.frameJobHash,
      frameIndex: frameJob.spec.frameIndex,
      frameSpecHash: frameJob.spec.frameSpecHash,
      generationInputHash: frameJob.generationRequest.inputHash,
      artifacts,
      poseFrame: {
        assetId: frameJob.spec.output.assetId,
        durationFrames: frameJob.spec.durationFrames,
        anchors,
        contact: {type: frameJob.spec.contact},
        referenceFoot: frameJob.spec.referenceFoot,
      },
      qa,
    };
    const result = await assertPoseClipFrameProductionResultIntegrity(frameJob, {
      ...framePayload,
      resultHash: await hashPoseClipFrameProductionResultPayload(framePayload),
    });
    await this.#resultCache.set(frameExecutionKey, result);
    return {
      frameExecutionKey,
      resultCache: 'miss',
      generation: generated.report,
      stages: stageReports,
      result,
    };
  }
}
