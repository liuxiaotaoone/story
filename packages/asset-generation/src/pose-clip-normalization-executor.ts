import {
  ProductionVisualAssetSchema,
  PoseFrameNormalizationTransformSchema,
  assertPoseClipMattingResultIntegrity,
  assertPoseClipNormalizationProcessorSpecIntegrity,
  assertPoseClipNormalizationResultIntegrity,
  hashPoseClipNormalizationInput,
  hashPoseClipNormalizationResultPayload,
  hashPoseClipNormalizedFrameResultPayload,
  hashPoseFrameArtifactPayload,
  normalizedAssetId,
  poseFrameStageCacheKey,
  sha256Bytes,
  type PixelBounds,
  type PoseClipMattingResult,
  type PoseClipNormalizationResult,
  type PoseClipRawGenerationRequest,
  type PoseClipRawGenerationResult,
  type PoseFrameArtifact,
  type PoseFrameNormalizationTransform,
  type PoseFrameProcessorSpec,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import type {ContentAddressedAssetStore} from './local-cas-store.js';
import {
  InMemoryPoseFrameStageCache,
  type CachedPoseFrameStageOutput,
  type PoseFrameStageCache,
} from './pose-frame-cache.js';
import {PoseFrameProcessorTransientError} from './pose-frame-processor.js';
import type {PoseFrameNormalizer} from './pose-frame-normalizer.js';
import {decodeRgbaPng8} from './rgba-png.js';

const NORMALIZATION_PRODUCER = {name: 'pose-clip-normalization-executor', version: '0.1.0'} as const;

export interface PoseClipNormalizationAssetByteResolver {
  resolve(asset: Readonly<VisualAssetRecord>): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: 'image/png';
  }>;
}

export interface PoseClipNormalizationExecutorOptions {
  readonly resolver: PoseClipNormalizationAssetByteResolver;
  readonly cas: ContentAddressedAssetStore;
  readonly mattingSpec: PoseFrameProcessorSpec;
  readonly spec: PoseFrameProcessorSpec;
  readonly processor: PoseFrameNormalizer;
  readonly stageCache?: PoseFrameStageCache;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export interface PoseClipNormalizationFrameReport {
  readonly frameIndex: number;
  readonly cache: 'hit' | 'miss';
  readonly attempts: number;
  readonly cacheKey: string;
  readonly normalizationInputHash: string;
}

export interface PoseClipNormalizationExecution {
  readonly result: PoseClipNormalizationResult;
  readonly frames: readonly PoseClipNormalizationFrameReport[];
}

export class PoseClipNormalizationExecutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseClipNormalizationExecutionError';
  }
}

interface PreparedOutput {
  readonly mattedArtifact: PoseFrameArtifact;
  readonly bytes: Uint8Array;
  readonly createdAt: string;
  readonly cacheKey: string;
  readonly normalizationInputHash: string;
  readonly transform: PoseFrameNormalizationTransform;
  readonly cache: 'hit' | 'miss';
  readonly attempts: number;
}

async function retry<T>(
  label: string,
  maxAttempts: number,
  operation: () => Promise<T>,
): Promise<{value: T; attempts: number}> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {value: await operation(), attempts: attempt};
    } catch (error) {
      if (!(error instanceof PoseFrameProcessorTransientError)) throw error;
      lastError = error;
    }
  }
  throw new PoseClipNormalizationExecutionError(
    'NORMALIZATION_RETRY_EXHAUSTED', `${label} failed after ${maxAttempts} attempts`, {cause: lastError},
  );
}

function visibleBounds(pixels: Uint8Array, width: number, height: number): PixelBounds | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? undefined : {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

export class PoseClipNormalizationExecutor {
  readonly #stageCache: PoseFrameStageCache;
  readonly #maxAttempts: number;

  constructor(private readonly options: PoseClipNormalizationExecutorOptions) {
    this.#stageCache = options.stageCache ?? new InMemoryPoseFrameStageCache();
    this.#maxAttempts = options.maxAttempts ?? 2;
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts <= 0) {
      throw new TypeError('Normalization maxAttempts must be a positive integer');
    }
  }

  async #prepareSpec(): Promise<PoseFrameProcessorSpec> {
    const spec = await assertPoseClipNormalizationProcessorSpecIntegrity(this.options.spec);
    if (
      this.options.processor.stage !== 'normalized'
      || this.options.processor.id !== spec.processor.name
      || this.options.processor.version !== spec.processor.version
    ) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_PROCESSOR_BINDING_INVALID',
      `Expected ${spec.processor.name}@${spec.processor.version}`,
    );
    return spec;
  }

  async #readMatted(asset: VisualAssetRecord, frameIndex: number): Promise<Uint8Array> {
    let resolved: Awaited<ReturnType<PoseClipNormalizationAssetByteResolver['resolve']>>;
    try {
      resolved = await this.options.resolver.resolve(asset);
    } catch (error) {
      throw new PoseClipNormalizationExecutionError(
        'NORMALIZATION_MATTED_CAS_READ_FAILED', `Frame ${frameIndex}`, {cause: error},
      );
    }
    const bytes = resolved.bytes.slice();
    if (await sha256Bytes(bytes) !== asset.contentHash) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_MATTED_CONTENT_HASH_MISMATCH', `Frame ${frameIndex}`,
    );
    let decoded: ReturnType<typeof decodeRgbaPng8>;
    try {
      decoded = decodeRgbaPng8(bytes);
    } catch (error) {
      throw new PoseClipNormalizationExecutionError(
        'NORMALIZATION_MATTED_RGBA_INVALID', `Frame ${frameIndex}`, {cause: error},
      );
    }
    if (decoded.width !== asset.width || decoded.height !== asset.height || visibleBounds(
      decoded.pixels, decoded.width, decoded.height,
    ) === undefined) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_MATTED_METADATA_INVALID', `Frame ${frameIndex}`,
    );
    return bytes;
  }

  #validateTransform(
    input: unknown,
    mattedAsset: VisualAssetRecord,
    frameIndex: number,
  ): PoseFrameNormalizationTransform {
    const parsed = PoseFrameNormalizationTransformSchema.safeParse(input);
    if (!parsed.success) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_TRANSFORM_INVALID', `Frame ${frameIndex}`, {cause: parsed.error},
    );
    const transform = parsed.data;
    const source = transform.sourceBounds;
    const destination = transform.destinationBounds;
    if (
      source.x + source.width > mattedAsset.width
      || source.y + source.height > mattedAsset.height
      || destination.x + destination.width > transform.canvas.width
      || destination.y + destination.height > transform.canvas.height
    ) throw new PoseClipNormalizationExecutionError('NORMALIZATION_TRANSFORM_INVALID', `Frame ${frameIndex}`);
    return transform;
  }

  #validateOutput(
    bytes: Uint8Array,
    transform: PoseFrameNormalizationTransform,
    frameIndex: number,
  ): Uint8Array {
    let decoded: ReturnType<typeof decodeRgbaPng8>;
    try {
      decoded = decodeRgbaPng8(bytes);
    } catch (error) {
      throw new PoseClipNormalizationExecutionError(
        'NORMALIZATION_OUTPUT_RGBA_INVALID', `Frame ${frameIndex}`, {cause: error},
      );
    }
    if (decoded.width !== transform.canvas.width || decoded.height !== transform.canvas.height) {
      throw new PoseClipNormalizationExecutionError('NORMALIZATION_OUTPUT_CANVAS_MISMATCH', `Frame ${frameIndex}`);
    }
    const bounds = visibleBounds(decoded.pixels, decoded.width, decoded.height);
    if (bounds === undefined) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_OUTPUT_FOREGROUND_EMPTY', `Frame ${frameIndex}`,
    );
    const expected = transform.destinationBounds;
    if (
      bounds.x < expected.x
      || bounds.y < expected.y
      || bounds.x + bounds.width > expected.x + expected.width
      || bounds.y + bounds.height > expected.y + expected.height
    ) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_OUTPUT_BOUNDS_INVALID', `Frame ${frameIndex}`,
    );
    return bytes.slice();
  }

  async #validateCached(
    cached: CachedPoseFrameStageOutput,
    transform: PoseFrameNormalizationTransform,
    frameIndex: number,
  ): Promise<{bytes: Uint8Array; createdAt: string}> {
    if (await sha256Bytes(cached.bytes) !== cached.contentHash) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_CACHE_CONTENT_HASH_MISMATCH', `Frame ${frameIndex}`,
    );
    const bytes = this.#validateOutput(cached.bytes, transform, frameIndex);
    if (
      cached.width !== transform.canvas.width
      || cached.height !== transform.canvas.height
      || cached.alphaMode !== 'straight'
      || cached.anchors !== undefined
    ) throw new PoseClipNormalizationExecutionError(
      'NORMALIZATION_CACHE_METADATA_MISMATCH', `Frame ${frameIndex}`,
    );
    return {bytes, createdAt: cached.createdAt};
  }

  async execute(
    requestInput: PoseClipRawGenerationRequest,
    rawResultInput: PoseClipRawGenerationResult,
    mattingResultInput: PoseClipMattingResult,
  ): Promise<PoseClipNormalizationExecution> {
    const mattingResult = await assertPoseClipMattingResultIntegrity(
      requestInput, rawResultInput, this.options.mattingSpec, mattingResultInput,
    );
    const spec = await this.#prepareSpec();
    const mattedBytes = await Promise.all(mattingResult.frameResults.map(({artifact}, frameIndex) => (
      this.#readMatted(artifact.asset, frameIndex)
    )));
    const prepared: PreparedOutput[] = [];
    const batchOutputs = new Map<string, {bytes: Uint8Array; createdAt: string; transform: PoseFrameNormalizationTransform}>();
    for (const [frameIndex, mattedFrame] of mattingResult.frameResults.entries()) {
      const mattedArtifact = mattedFrame.artifact;
      const bytes = mattedBytes[frameIndex]!;
      const processorInput = {
        bytes: bytes.slice(),
        inputContentHash: mattedArtifact.asset.contentHash,
        spec: structuredClone(spec),
      };
      const transform = this.#validateTransform(
        await this.options.processor.plan(processorInput), mattedArtifact.asset, frameIndex,
      );
      const cacheKey = await poseFrameStageCacheKey({
        stage: 'normalized',
        inputContentHash: mattedArtifact.asset.contentHash,
        processorSpecHash: spec.processorSpecHash,
      });
      const normalizationInputHash = await hashPoseClipNormalizationInput({
        mattedArtifactHash: mattedArtifact.outputHash,
        processorSpecHash: spec.processorSpecHash,
      });
      const batch = batchOutputs.get(cacheKey);
      if (batch !== undefined) {
        prepared.push({
          mattedArtifact, bytes: batch.bytes.slice(), createdAt: batch.createdAt,
          transform: structuredClone(batch.transform), cacheKey, normalizationInputHash,
          cache: 'hit', attempts: 0,
        });
        continue;
      }
      const cached = await this.#stageCache.get(cacheKey);
      if (cached !== undefined) {
        const output = await this.#validateCached(cached, transform, frameIndex);
        batchOutputs.set(cacheKey, {...output, transform: structuredClone(transform)});
        prepared.push({mattedArtifact, ...output, transform, cacheKey, normalizationInputHash, cache: 'hit', attempts: 0});
        continue;
      }
      const processed = await retry(`normalization frame ${frameIndex}`, this.#maxAttempts, () => (
        this.options.processor.process({...processorInput, bytes: bytes.slice(), spec: structuredClone(spec)})
      ));
      if (processed.value.anchors !== undefined) throw new PoseClipNormalizationExecutionError(
        'NORMALIZATION_OUTPUT_ANCHORS_UNEXPECTED', `Frame ${frameIndex}`,
      );
      const outputBytes = this.#validateOutput(processed.value.bytes, transform, frameIndex);
      const createdAt = (this.options.now ?? (() => new Date()))().toISOString();
      batchOutputs.set(cacheKey, {bytes: outputBytes.slice(), createdAt, transform: structuredClone(transform)});
      prepared.push({
        mattedArtifact, bytes: outputBytes, createdAt, transform, cacheKey, normalizationInputHash,
        cache: 'miss', attempts: processed.attempts,
      });
    }

    // All four normalized outputs are validated before the first Normalized CAS publication.
    const frameResults = [];
    const publishedCacheKeys = new Set<string>();
    for (const [frameIndex, output] of prepared.entries()) {
      const stored = await this.options.cas.putPng(output.bytes);
      if (output.cache === 'miss' && !publishedCacheKeys.has(output.cacheKey)) {
        await this.#stageCache.set(output.cacheKey, {
          bytes: stored.bytes,
          contentHash: stored.contentHash,
          width: output.transform.canvas.width,
          height: output.transform.canvas.height,
          alphaMode: 'straight',
          createdAt: output.createdAt,
        });
        publishedCacheKeys.add(output.cacheKey);
      }
      const mattedFrame = mattingResult.frameResults[frameIndex]!;
      const asset = ProductionVisualAssetSchema.parse({
        id: normalizedAssetId(output.mattedArtifact.asset.id),
        uri: stored.uri,
        contentHash: stored.contentHash,
        source: 'generated',
        provenance: {
          inputHash: output.normalizationInputHash,
          ...(spec.model === undefined ? {} : {modelId: spec.model.modelId}),
          producer: spec.processor,
          createdAt: output.createdAt,
        },
        qaStatus: 'pending',
        kind: output.mattedArtifact.asset.kind,
        width: output.transform.canvas.width,
        height: output.transform.canvas.height,
        alphaMode: 'straight',
      });
      const artifactPayload = {
        stage: 'normalized' as const,
        inputHash: output.mattedArtifact.outputHash,
        producer: spec.processor,
        asset,
      };
      const artifact = {...artifactPayload, outputHash: await hashPoseFrameArtifactPayload(artifactPayload)};
      const framePayload = {
        schemaVersion: '1.0.0' as const,
        frameJobHash: mattedFrame.frameJobHash,
        frameIndex,
        frameSpecHash: mattedFrame.frameSpecHash,
        generationInputHash: mattedFrame.generationInputHash,
        mattedArtifactHash: output.mattedArtifact.outputHash,
        normalizationInputHash: output.normalizationInputHash,
        transform: output.transform,
        artifact,
      };
      frameResults.push({...framePayload, resultHash: await hashPoseClipNormalizedFrameResultPayload(framePayload)});
    }
    const payload = {
      schemaVersion: '1.0.0' as const,
      productionRequestHash: mattingResult.productionRequestHash,
      mattingResultHash: mattingResult.resultHash,
      processorSpecHash: spec.processorSpecHash,
      frameResults,
      producer: NORMALIZATION_PRODUCER,
    };
    const result = await assertPoseClipNormalizationResultIntegrity(
      requestInput, rawResultInput, this.options.mattingSpec, mattingResult, spec,
      {...payload, resultHash: await hashPoseClipNormalizationResultPayload(payload)},
    );
    return {
      result,
      frames: prepared.map((output, frameIndex) => ({
        frameIndex, cache: output.cache, attempts: output.attempts,
        cacheKey: output.cacheKey, normalizationInputHash: output.normalizationInputHash,
      })),
    };
  }
}
