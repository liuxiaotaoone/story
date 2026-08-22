import {
  ProductionVisualAssetSchema,
  assertPoseClipMattingProcessorSpecIntegrity,
  assertPoseClipMattingResultIntegrity,
  assertPoseClipRawGenerationResultIntegrity,
  hashPoseClipMattedFrameResultPayload,
  hashPoseClipMattingInput,
  hashPoseClipMattingResultPayload,
  hashPoseFrameArtifactPayload,
  poseFrameStageCacheKey,
  sha256Bytes,
  type PoseClipMattingResult,
  type PoseClipRawGenerationRequest,
  type PoseClipRawGenerationResult,
  type PoseFrameArtifact,
  type PoseFrameProcessorSpec,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import type {ContentAddressedAssetStore} from './local-cas-store.js';
import {
  InMemoryPoseFrameStageCache,
  type CachedPoseFrameStageOutput,
  type PoseFrameStageCache,
} from './pose-frame-cache.js';
import {
  PoseFrameProcessorTransientError,
  type PoseFrameProcessor,
} from './pose-frame-processor.js';
import {inspectPng} from './png.js';
import {decodeRgbaPng8, rgbaAlphaRange} from './rgba-png.js';

const MATTING_PRODUCER = {name: 'pose-clip-matting-executor', version: '0.1.0'} as const;

export interface PoseClipMattingAssetByteResolver {
  resolve(asset: Readonly<VisualAssetRecord>): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: 'image/png';
  }>;
}

export interface PoseClipMattingExecutorOptions {
  readonly resolver: PoseClipMattingAssetByteResolver;
  readonly cas: ContentAddressedAssetStore;
  readonly spec: PoseFrameProcessorSpec;
  readonly processor: PoseFrameProcessor;
  readonly stageCache?: PoseFrameStageCache;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export interface PoseClipMattingFrameReport {
  readonly frameIndex: number;
  readonly cache: 'hit' | 'miss';
  readonly attempts: number;
  readonly cacheKey: string;
  readonly mattingInputHash: string;
}

export interface PoseClipMattingExecution {
  readonly result: PoseClipMattingResult;
  readonly frames: readonly PoseClipMattingFrameReport[];
}

export class PoseClipMattingExecutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseClipMattingExecutionError';
  }
}

interface PreparedOutput {
  readonly rawArtifact: PoseFrameArtifact;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
  readonly cacheKey: string;
  readonly mattingInputHash: string;
  readonly cache: 'hit' | 'miss';
  readonly attempts: number;
}

interface AttemptResult<T> {
  readonly value: T;
  readonly attempts: number;
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
      if (!(error instanceof PoseFrameProcessorTransientError)) throw error;
      lastError = error;
    }
  }
  throw new PoseClipMattingExecutionError(
    'MATTING_RETRY_EXHAUSTED',
    `${label} failed after ${maxAttempts} attempts`,
    {cause: lastError},
  );
}

export class PoseClipMattingExecutor {
  readonly #stageCache: PoseFrameStageCache;
  readonly #maxAttempts: number;

  constructor(private readonly options: PoseClipMattingExecutorOptions) {
    this.#stageCache = options.stageCache ?? new InMemoryPoseFrameStageCache();
    this.#maxAttempts = options.maxAttempts ?? 2;
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts <= 0) {
      throw new TypeError('Matting maxAttempts must be a positive integer');
    }
  }

  async #prepareSpec(): Promise<PoseFrameProcessorSpec> {
    const spec = await assertPoseClipMattingProcessorSpecIntegrity(this.options.spec);
    if (
      this.options.processor.stage !== 'matted'
      || this.options.processor.id !== spec.processor.name
      || this.options.processor.version !== spec.processor.version
    ) throw new PoseClipMattingExecutionError(
      'MATTING_PROCESSOR_BINDING_INVALID',
      `Expected ${spec.processor.name}@${spec.processor.version}`,
    );
    return spec;
  }

  async #readAndValidateRaw(asset: VisualAssetRecord, frameIndex: number): Promise<Uint8Array> {
    let resolved: Awaited<ReturnType<PoseClipMattingAssetByteResolver['resolve']>>;
    try {
      resolved = await this.options.resolver.resolve(asset);
    } catch (error) {
      throw new PoseClipMattingExecutionError('MATTING_RAW_CAS_READ_FAILED', `Frame ${frameIndex}`, {cause: error});
    }
    const bytes = resolved.bytes.slice();
    if (await sha256Bytes(bytes) !== asset.contentHash) throw new PoseClipMattingExecutionError(
      'MATTING_RAW_CONTENT_HASH_MISMATCH',
      `Frame ${frameIndex}`,
    );
    let metadata: ReturnType<typeof inspectPng>;
    try {
      metadata = inspectPng(bytes);
    } catch (error) {
      throw new PoseClipMattingExecutionError('MATTING_RAW_PNG_INVALID', `Frame ${frameIndex}`, {cause: error});
    }
    if (
      metadata.width !== asset.width
      || metadata.height !== asset.height
      || metadata.alphaMode !== asset.alphaMode
    ) throw new PoseClipMattingExecutionError('MATTING_RAW_METADATA_MISMATCH', `Frame ${frameIndex}`);
    return bytes;
  }

  #validateMattedBytes(
    bytes: Uint8Array,
    rawAsset: VisualAssetRecord,
    frameIndex: number,
  ): {bytes: Uint8Array; width: number; height: number} {
    let decoded: ReturnType<typeof decodeRgbaPng8>;
    try {
      decoded = decodeRgbaPng8(bytes);
    } catch (error) {
      throw new PoseClipMattingExecutionError('MATTING_OUTPUT_RGBA_INVALID', `Frame ${frameIndex}`, {cause: error});
    }
    if (decoded.width !== rawAsset.width || decoded.height !== rawAsset.height) throw new PoseClipMattingExecutionError(
      'MATTING_OUTPUT_DIMENSIONS_CHANGED',
      `Frame ${frameIndex}`,
    );
    const alpha = rgbaAlphaRange(decoded.pixels);
    if (alpha.min === 255) throw new PoseClipMattingExecutionError(
      'MATTING_OUTPUT_ALPHA_OPAQUE',
      `Frame ${frameIndex}`,
    );
    if (alpha.max === 0) throw new PoseClipMattingExecutionError(
      'MATTING_OUTPUT_ALPHA_EMPTY',
      `Frame ${frameIndex}`,
    );
    return {bytes: bytes.slice(), width: decoded.width, height: decoded.height};
  }

  async #validateCachedOutput(
    cached: CachedPoseFrameStageOutput,
    rawAsset: VisualAssetRecord,
    frameIndex: number,
  ): Promise<{
    bytes: Uint8Array;
    width: number;
    height: number;
    createdAt: string;
  }> {
    if (await sha256Bytes(cached.bytes) !== cached.contentHash) throw new PoseClipMattingExecutionError(
      'MATTING_CACHE_CONTENT_HASH_MISMATCH',
      `Frame ${frameIndex}`,
    );
    const validated = this.#validateMattedBytes(cached.bytes, rawAsset, frameIndex);
    if (
      cached.width !== validated.width
      || cached.height !== validated.height
      || cached.alphaMode !== 'straight'
      || cached.anchors !== undefined
    ) throw new PoseClipMattingExecutionError('MATTING_CACHE_METADATA_MISMATCH', `Frame ${frameIndex}`);
    return {...validated, createdAt: cached.createdAt};
  }

  async execute(
    requestInput: PoseClipRawGenerationRequest,
    rawResultInput: PoseClipRawGenerationResult,
  ): Promise<PoseClipMattingExecution> {
    const rawResult = await assertPoseClipRawGenerationResultIntegrity(requestInput, rawResultInput);
    const spec = await this.#prepareSpec();
    const rawBytes = await Promise.all(rawResult.frameResults.map(({artifact}, frameIndex) => (
      this.#readAndValidateRaw(artifact.asset, frameIndex)
    )));

    const batchOutputs = new Map<string, {
      bytes: Uint8Array;
      width: number;
      height: number;
      createdAt: string;
      attempts: number;
    }>();
    const prepared: PreparedOutput[] = [];
    for (const [frameIndex, rawFrame] of rawResult.frameResults.entries()) {
      const rawArtifact = rawFrame.artifact;
      const rawAsset = rawArtifact.asset;
      const cacheKey = await poseFrameStageCacheKey({
        stage: 'matted',
        inputContentHash: rawAsset.contentHash,
        processorSpecHash: spec.processorSpecHash,
      });
      const mattingInputHash = await hashPoseClipMattingInput({
        rawArtifactHash: rawArtifact.outputHash,
        processorSpecHash: spec.processorSpecHash,
      });
      const batch = batchOutputs.get(cacheKey);
      if (batch !== undefined) {
        prepared.push({
          rawArtifact,
          ...batch,
          bytes: batch.bytes.slice(),
          cacheKey,
          mattingInputHash,
          cache: 'hit',
          attempts: 0,
        });
        continue;
      }
      const cached = await this.#stageCache.get(cacheKey);
      if (cached !== undefined) {
        const output = await this.#validateCachedOutput(cached, rawAsset, frameIndex);
        batchOutputs.set(cacheKey, {...output, attempts: 0});
        prepared.push({
          rawArtifact,
          ...output,
          cacheKey,
          mattingInputHash,
          cache: 'hit',
          attempts: 0,
        });
        continue;
      }
      const processed = await retry(`matting frame ${frameIndex}`, this.#maxAttempts, () => this.options.processor.process({
        bytes: rawBytes[frameIndex]!.slice(),
        inputContentHash: rawAsset.contentHash,
        spec: structuredClone(spec),
      }));
      if (processed.value.anchors !== undefined) throw new PoseClipMattingExecutionError(
        'MATTING_OUTPUT_ANCHORS_UNEXPECTED',
        `Frame ${frameIndex}`,
      );
      const output = this.#validateMattedBytes(processed.value.bytes, rawAsset, frameIndex);
      const createdAt = (this.options.now ?? (() => new Date()))().toISOString();
      batchOutputs.set(cacheKey, {...output, createdAt, attempts: processed.attempts});
      prepared.push({
        rawArtifact,
        ...output,
        createdAt,
        cacheKey,
        mattingInputHash,
        cache: 'miss',
        attempts: processed.attempts,
      });
    }

    // All four outputs are validated before the first Matted CAS publication.
    const frameResults = [];
    const publishedCacheKeys = new Set<string>();
    for (const [frameIndex, output] of prepared.entries()) {
      const stored = await this.options.cas.putPng(output.bytes);
      if (output.cache === 'miss' && !publishedCacheKeys.has(output.cacheKey)) {
        await this.#stageCache.set(output.cacheKey, {
          bytes: stored.bytes,
          contentHash: stored.contentHash,
          width: output.width,
          height: output.height,
          alphaMode: 'straight',
          createdAt: output.createdAt,
        });
        publishedCacheKeys.add(output.cacheKey);
      }
      const rawFrame = rawResult.frameResults[frameIndex]!;
      const asset = ProductionVisualAssetSchema.parse({
        id: `${output.rawArtifact.asset.id}.matted`,
        uri: stored.uri,
        contentHash: stored.contentHash,
        source: 'generated',
        provenance: {
          inputHash: output.mattingInputHash,
          modelId: spec.model!.modelId,
          producer: spec.processor,
          createdAt: output.createdAt,
        },
        qaStatus: 'pending',
        kind: output.rawArtifact.asset.kind,
        width: output.width,
        height: output.height,
        alphaMode: 'straight',
      });
      const artifactPayload = {
        stage: 'matted' as const,
        inputHash: output.rawArtifact.outputHash,
        producer: spec.processor,
        asset,
      };
      const artifact = {
        ...artifactPayload,
        outputHash: await hashPoseFrameArtifactPayload(artifactPayload),
      };
      const framePayload = {
        schemaVersion: '1.0.0' as const,
        frameJobHash: rawFrame.frameJobHash,
        frameIndex,
        frameSpecHash: rawFrame.frameSpecHash,
        generationInputHash: rawFrame.generationInputHash,
        rawArtifactHash: output.rawArtifact.outputHash,
        mattingInputHash: output.mattingInputHash,
        artifact,
      };
      frameResults.push({
        ...framePayload,
        resultHash: await hashPoseClipMattedFrameResultPayload(framePayload),
      });
    }
    const payload = {
      schemaVersion: '1.0.0' as const,
      productionRequestHash: rawResult.productionRequestHash,
      rawGenerationResultHash: rawResult.resultHash,
      processorSpecHash: spec.processorSpecHash,
      frameResults,
      producer: MATTING_PRODUCER,
    };
    const result = await assertPoseClipMattingResultIntegrity(requestInput, rawResult, spec, {
      ...payload,
      resultHash: await hashPoseClipMattingResultPayload(payload),
    });
    return {
      result,
      frames: prepared.map((output, frameIndex) => ({
        frameIndex,
        cache: output.cache,
        attempts: output.attempts,
        cacheKey: output.cacheKey,
        mattingInputHash: output.mattingInputHash,
      })),
    };
  }
}
