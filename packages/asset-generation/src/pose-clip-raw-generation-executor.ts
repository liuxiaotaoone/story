import {
  ProductionVisualAssetSchema,
  assertPoseClipProductionRequestIntegrity,
  assertPoseClipRawGenerationResultIntegrity,
  hashPoseClipRawFrameGenerationResultPayload,
  hashPoseClipRawGenerationResultPayload,
  hashPoseFrameArtifactPayload,
  sha256Bytes,
  type PoseClipFrameJob,
  type PoseClipProductionRequest,
  type PoseClipRawFrameGenerationResult,
  type PoseClipRawGenerationResult,
  type PoseFrameArtifact,
} from '@pose-clip/schemas';
import {inspectPng} from './png.js';
import {
  InMemoryPoseFrameGenerationCache,
  InMemoryPoseFrameGenerationResumeCache,
  type PoseFrameGenerationCache,
  type PoseFrameGenerationResumeCache,
} from './pose-frame-cache.js';
import {
  isResumableImageGenerationProvider,
  type GeneratedImageArtifact,
  type GenerationSubmission,
  type ImageGenerationProvider,
} from './provider.js';
import {
  AssetGenerationTransientError,
  assertGenerationRequestIntegrity,
} from './integrity.js';
import type {ContentAddressedAssetStore} from './local-cas-store.js';

const RAW_GENERATION_PRODUCER = {name: 'pose-clip-raw-generation-executor', version: '0.1.0'} as const;

export interface PoseClipRawGenerationExecutorOptions {
  readonly provider: ImageGenerationProvider;
  readonly cas: ContentAddressedAssetStore;
  readonly generationCache?: PoseFrameGenerationCache;
  readonly generationResumeCache?: PoseFrameGenerationResumeCache;
  readonly maxAttempts?: number;
}

export interface PoseClipRawGenerationFrameReport {
  readonly frameIndex: number;
  readonly cache: 'hit' | 'miss';
  readonly attempts: number;
  readonly generationInputHash: string;
}

export interface PoseClipRawGenerationExecution {
  readonly result: PoseClipRawGenerationResult;
  readonly frames: readonly PoseClipRawGenerationFrameReport[];
}

export class PoseClipRawGenerationExecutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseClipRawGenerationExecutionError';
  }
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
      if (!(error instanceof AssetGenerationTransientError)) throw error;
      lastError = error;
    }
  }
  throw new PoseClipRawGenerationExecutionError(
    'RAW_GENERATION_RETRY_EXHAUSTED',
    `${label} failed after ${maxAttempts} attempts`,
    {cause: lastError},
  );
}

export class PoseClipRawGenerationExecutor {
  readonly #generationCache: PoseFrameGenerationCache;
  readonly #generationResumeCache: PoseFrameGenerationResumeCache;
  readonly #maxAttempts: number;

  constructor(private readonly options: PoseClipRawGenerationExecutorOptions) {
    this.#generationCache = options.generationCache ?? new InMemoryPoseFrameGenerationCache();
    this.#generationResumeCache = options.generationResumeCache ?? new InMemoryPoseFrameGenerationResumeCache();
    this.#maxAttempts = options.maxAttempts ?? 2;
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts <= 0) {
      throw new TypeError('Raw generation maxAttempts must be a positive integer');
    }
  }

  async #validateGeneratedArtifact(
    frameJob: PoseClipFrameJob,
    input: GeneratedImageArtifact,
  ): Promise<GeneratedImageArtifact> {
    const parsed = ProductionVisualAssetSchema.safeParse(input.asset);
    if (!parsed.success) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_ASSET_INVALID',
      `Frame ${frameJob.spec.frameIndex}`,
      {cause: parsed.error},
    );
    const asset = parsed.data;
    if (
      asset.id !== frameJob.spec.output.assetId
      || asset.kind !== frameJob.spec.output.kind
      || asset.source !== 'generated'
      || asset.provenance?.inputHash !== frameJob.generationRequest.inputHash
    ) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_BINDING_MISMATCH',
      `Frame ${frameJob.spec.frameIndex}`,
    );
    if (await sha256Bytes(input.bytes) !== asset.contentHash) {
      throw new PoseClipRawGenerationExecutionError(
        'RAW_GENERATION_CONTENT_HASH_MISMATCH',
        `Frame ${frameJob.spec.frameIndex}`,
      );
    }
    let metadata: ReturnType<typeof inspectPng>;
    try {
      metadata = inspectPng(input.bytes);
    } catch (error) {
      throw new PoseClipRawGenerationExecutionError(
        'RAW_GENERATION_PNG_INVALID',
        `Frame ${frameJob.spec.frameIndex}`,
        {cause: error},
      );
    }
    if (
      metadata.width !== asset.width
      || metadata.height !== asset.height
      || metadata.alphaMode !== asset.alphaMode
    ) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_PNG_METADATA_MISMATCH',
      `Frame ${frameJob.spec.frameIndex}`,
    );
    const stored = await this.options.cas.putPng(input.bytes);
    if (stored.contentHash !== asset.contentHash || stored.uri !== asset.uri) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_CAS_BINDING_MISMATCH',
      `Frame ${frameJob.spec.frameIndex}`,
    );
    return {
      bytes: stored.bytes,
      filePath: stored.filePath,
      asset,
      providerMetadata: structuredClone(input.providerMetadata),
    };
  }

  #assertSubmissionBinding(frameJob: PoseClipFrameJob, submission: GenerationSubmission): void {
    if (
      submission.generationInputHash !== frameJob.generationRequest.inputHash
      || submission.promptId.length === 0
    ) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_SUBMISSION_BINDING_MISMATCH',
      `Frame ${frameJob.spec.frameIndex}`,
    );
  }

  async #generate(frameJob: PoseClipFrameJob): Promise<{
    artifact: GeneratedImageArtifact;
    report: PoseClipRawGenerationFrameReport;
  }> {
    const request = await assertGenerationRequestIntegrity(frameJob.generationRequest);
    if (this.options.provider.id !== request.provider) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_PROVIDER_MISMATCH',
      `Expected ${request.provider}, received ${this.options.provider.id}`,
    );
    const cacheKey = request.inputHash;
    const cached = await this.#generationCache.get(cacheKey);
    if (cached !== undefined) {
      await this.#generationResumeCache.delete(cacheKey);
      return {
        artifact: await this.#validateGeneratedArtifact(frameJob, cached),
        report: {frameIndex: frameJob.spec.frameIndex, cache: 'hit', attempts: 0, generationInputHash: cacheKey},
      };
    }

    let outputs: GeneratedImageArtifact[];
    let attempts: number;
    const provider = this.options.provider;
    if (isResumableImageGenerationProvider(provider)) {
      let submission = await this.#generationResumeCache.get(cacheKey);
      let submitAttempts = 0;
      if (submission === undefined) {
        const submitted = await retry(
          `raw generation submit frame ${frameJob.spec.frameIndex}`,
          this.#maxAttempts,
          () => provider.submit(request),
        );
        submission = submitted.value;
        submitAttempts = submitted.attempts;
        this.#assertSubmissionBinding(frameJob, submission);
        await this.#generationResumeCache.set(cacheKey, submission);
      } else {
        this.#assertSubmissionBinding(frameJob, submission);
      }
      const collected = await retry(
        `raw generation collect frame ${frameJob.spec.frameIndex}`,
        this.#maxAttempts,
        () => provider.collect(request, submission!),
      );
      outputs = collected.value;
      attempts = Math.max(submitAttempts, collected.attempts);
    } else {
      const generated = await retry(
        `raw generation frame ${frameJob.spec.frameIndex}`,
        this.#maxAttempts,
        () => provider.generate(request),
      );
      outputs = generated.value;
      attempts = generated.attempts;
    }
    if (outputs.length !== 1 || outputs[0] === undefined) throw new PoseClipRawGenerationExecutionError(
      'RAW_GENERATION_OUTPUT_COUNT_MISMATCH',
      `Frame ${frameJob.spec.frameIndex}`,
    );
    const artifact = await this.#validateGeneratedArtifact(frameJob, outputs[0]);
    await this.#generationCache.set(cacheKey, artifact);
    await this.#generationResumeCache.delete(cacheKey);
    return {
      artifact,
      report: {frameIndex: frameJob.spec.frameIndex, cache: 'miss', attempts, generationInputHash: cacheKey},
    };
  }

  async execute(input: PoseClipProductionRequest): Promise<PoseClipRawGenerationExecution> {
    const request = await assertPoseClipProductionRequestIntegrity(input);
    const frameResults: PoseClipRawFrameGenerationResult[] = [];
    const reports: PoseClipRawGenerationFrameReport[] = [];
    for (const [index, frameJob] of request.frames.entries()) {
      const generated = await this.#generate(frameJob);
      const producer = generated.artifact.asset.provenance?.producer;
      if (producer === undefined) throw new PoseClipRawGenerationExecutionError(
        'RAW_GENERATION_PROVENANCE_MISSING',
        `Frame ${index}`,
      );
      const artifactPayload = {
        stage: 'raw' as const,
        inputHash: frameJob.generationRequest.inputHash,
        producer,
        asset: generated.artifact.asset,
      } satisfies Omit<PoseFrameArtifact, 'outputHash'>;
      const artifact = {
        ...artifactPayload,
        outputHash: await hashPoseFrameArtifactPayload(artifactPayload),
      };
      const framePayload = {
        schemaVersion: '1.0.0' as const,
        frameJobHash: frameJob.frameJobHash,
        frameIndex: frameJob.spec.frameIndex,
        frameSpecHash: frameJob.spec.frameSpecHash,
        generationInputHash: frameJob.generationRequest.inputHash,
        artifact,
      };
      frameResults.push({
        ...framePayload,
        resultHash: await hashPoseClipRawFrameGenerationResultPayload(framePayload),
      });
      reports.push(generated.report);
    }
    const payload = {
      schemaVersion: '1.0.0' as const,
      productionRequestHash: request.requestHash,
      frameResults,
      producer: RAW_GENERATION_PRODUCER,
    };
    return {
      frames: reports,
      result: await assertPoseClipRawGenerationResultIntegrity(request, {
        ...payload,
        resultHash: await hashPoseClipRawGenerationResultPayload(payload),
      }),
    };
  }
}
