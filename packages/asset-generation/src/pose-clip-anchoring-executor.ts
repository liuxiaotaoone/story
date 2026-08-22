import {
  PoseAnchorsSchema,
  ProductionVisualAssetSchema,
  anchoredAssetId,
  assertPoseClipAnchoringProcessorSpecIntegrity,
  assertPoseClipAnchoringResultIntegrity,
  assertPoseClipNormalizationResultIntegrity,
  hashPoseClipAnchoredFrameResultPayload,
  hashPoseClipAnchoringInput,
  hashPoseClipAnchoringResultPayload,
  hashPoseFrameArtifactPayload,
  poseFrameStageCacheKey,
  sha256Bytes,
  type PoseAnchors,
  type PoseClipAnchoringResult,
  type PoseClipMattingResult,
  type PoseClipNormalizationResult,
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
import {decodeRgbaPng8} from './rgba-png.js';

const ANCHORING_PRODUCER = {name: 'pose-clip-anchoring-executor', version: '0.1.0'} as const;

export interface PoseClipAnchoringAssetByteResolver {
  resolve(asset: Readonly<VisualAssetRecord>): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: 'image/png';
  }>;
}

export interface PoseClipAnchoringExecutorOptions {
  readonly resolver: PoseClipAnchoringAssetByteResolver;
  readonly cas: ContentAddressedAssetStore;
  readonly mattingSpec: PoseFrameProcessorSpec;
  readonly normalizationSpec: PoseFrameProcessorSpec;
  readonly spec: PoseFrameProcessorSpec;
  readonly processor: PoseFrameProcessor;
  readonly stageCache?: PoseFrameStageCache;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export interface PoseClipAnchoringFrameReport {
  readonly frameIndex: number;
  readonly cache: 'hit' | 'miss';
  readonly attempts: number;
  readonly cacheKey: string;
  readonly anchorInputHash: string;
}

export interface PoseClipAnchoringExecution {
  readonly result: PoseClipAnchoringResult;
  readonly frames: readonly PoseClipAnchoringFrameReport[];
}

export class PoseClipAnchoringExecutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseClipAnchoringExecutionError';
  }
}

interface PreparedOutput {
  readonly normalizedArtifact: PoseFrameArtifact;
  readonly bytes: Uint8Array;
  readonly anchors: PoseAnchors;
  readonly createdAt: string;
  readonly cacheKey: string;
  readonly anchorInputHash: string;
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
  throw new PoseClipAnchoringExecutionError(
    'ANCHORING_RETRY_EXHAUSTED', `${label} failed after ${maxAttempts} attempts`, {cause: lastError},
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function hasRequiredAnchor(anchors: PoseAnchors, requirement: string): boolean {
  if (requirement.startsWith('auxiliary:')) {
    return anchors.auxiliary?.[requirement.slice('auxiliary:'.length)] !== undefined;
  }
  return anchors[requirement as keyof Omit<PoseAnchors, 'auxiliary'>] !== undefined;
}

export class PoseClipAnchoringExecutor {
  readonly #stageCache: PoseFrameStageCache;
  readonly #maxAttempts: number;

  constructor(private readonly options: PoseClipAnchoringExecutorOptions) {
    this.#stageCache = options.stageCache ?? new InMemoryPoseFrameStageCache();
    this.#maxAttempts = options.maxAttempts ?? 2;
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts <= 0) {
      throw new TypeError('Anchoring maxAttempts must be a positive integer');
    }
  }

  async #prepareSpec(): Promise<PoseFrameProcessorSpec> {
    const spec = await assertPoseClipAnchoringProcessorSpecIntegrity(this.options.spec);
    if (
      this.options.processor.stage !== 'anchored'
      || this.options.processor.id !== spec.processor.name
      || this.options.processor.version !== spec.processor.version
    ) throw new PoseClipAnchoringExecutionError(
      'ANCHORING_PROCESSOR_BINDING_INVALID',
      `Expected ${spec.processor.name}@${spec.processor.version}`,
    );
    return spec;
  }

  async #readNormalized(asset: VisualAssetRecord, frameIndex: number): Promise<Uint8Array> {
    let resolved: Awaited<ReturnType<PoseClipAnchoringAssetByteResolver['resolve']>>;
    try {
      resolved = await this.options.resolver.resolve(asset);
    } catch (error) {
      throw new PoseClipAnchoringExecutionError(
        'ANCHORING_NORMALIZED_CAS_READ_FAILED', `Frame ${frameIndex}`, {cause: error},
      );
    }
    const bytes = resolved.bytes.slice();
    if (await sha256Bytes(bytes) !== asset.contentHash) throw new PoseClipAnchoringExecutionError(
      'ANCHORING_NORMALIZED_CONTENT_HASH_MISMATCH', `Frame ${frameIndex}`,
    );
    let decoded: ReturnType<typeof decodeRgbaPng8>;
    try {
      decoded = decodeRgbaPng8(bytes);
    } catch (error) {
      throw new PoseClipAnchoringExecutionError(
        'ANCHORING_NORMALIZED_RGBA_INVALID', `Frame ${frameIndex}`, {cause: error},
      );
    }
    const hasForeground = decoded.pixels.some((value, index) => index % 4 === 3 && value > 0);
    if (decoded.width !== asset.width || decoded.height !== asset.height) {
      throw new PoseClipAnchoringExecutionError('ANCHORING_NORMALIZED_METADATA_INVALID', `Frame ${frameIndex}`);
    }
    if (!hasForeground) throw new PoseClipAnchoringExecutionError(
      'ANCHORING_NORMALIZED_FOREGROUND_EMPTY', `Frame ${frameIndex}`,
    );
    return bytes;
  }

  #validateAnchors(input: unknown, required: readonly string[], frameIndex: number): PoseAnchors {
    const parsed = PoseAnchorsSchema.safeParse(input);
    if (!parsed.success) throw new PoseClipAnchoringExecutionError(
      'ANCHORING_OUTPUT_ANCHORS_INVALID', `Frame ${frameIndex}`, {cause: parsed.error},
    );
    if (required.some((requirement) => !hasRequiredAnchor(parsed.data, requirement))) {
      throw new PoseClipAnchoringExecutionError('ANCHORING_REQUIRED_ANCHOR_MISSING', `Frame ${frameIndex}`);
    }
    return parsed.data;
  }

  #validateOutput(
    outputBytes: Uint8Array,
    inputBytes: Uint8Array,
    normalizedAsset: VisualAssetRecord,
    anchorsInput: unknown,
    required: readonly string[],
    frameIndex: number,
  ): {bytes: Uint8Array; anchors: PoseAnchors} {
    if (!bytesEqual(outputBytes, inputBytes)) throw new PoseClipAnchoringExecutionError(
      'ANCHORING_OUTPUT_BYTES_CHANGED', `Frame ${frameIndex}`,
    );
    let decoded: ReturnType<typeof decodeRgbaPng8>;
    try {
      decoded = decodeRgbaPng8(outputBytes);
    } catch (error) {
      throw new PoseClipAnchoringExecutionError(
        'ANCHORING_OUTPUT_RGBA_INVALID', `Frame ${frameIndex}`, {cause: error},
      );
    }
    if (decoded.width !== normalizedAsset.width || decoded.height !== normalizedAsset.height) {
      throw new PoseClipAnchoringExecutionError('ANCHORING_OUTPUT_CANVAS_MISMATCH', `Frame ${frameIndex}`);
    }
    return {
      bytes: outputBytes.slice(),
      anchors: this.#validateAnchors(anchorsInput, required, frameIndex),
    };
  }

  async #validateCached(
    cached: CachedPoseFrameStageOutput,
    inputBytes: Uint8Array,
    normalizedAsset: VisualAssetRecord,
    required: readonly string[],
    frameIndex: number,
  ): Promise<{bytes: Uint8Array; anchors: PoseAnchors; createdAt: string}> {
    if (await sha256Bytes(cached.bytes) !== cached.contentHash) throw new PoseClipAnchoringExecutionError(
      'ANCHORING_CACHE_CONTENT_HASH_MISMATCH', `Frame ${frameIndex}`,
    );
    if (
      cached.width !== normalizedAsset.width
      || cached.height !== normalizedAsset.height
      || cached.alphaMode !== 'straight'
      || cached.anchors === undefined
    ) throw new PoseClipAnchoringExecutionError('ANCHORING_CACHE_METADATA_MISMATCH', `Frame ${frameIndex}`);
    return {
      ...this.#validateOutput(
        cached.bytes, inputBytes, normalizedAsset, cached.anchors, required, frameIndex,
      ),
      createdAt: cached.createdAt,
    };
  }

  async execute(
    requestInput: PoseClipRawGenerationRequest,
    rawResultInput: PoseClipRawGenerationResult,
    mattingResultInput: PoseClipMattingResult,
    normalizationResultInput: PoseClipNormalizationResult,
  ): Promise<PoseClipAnchoringExecution> {
    const normalizationResult = await assertPoseClipNormalizationResultIntegrity(
      requestInput,
      rawResultInput,
      this.options.mattingSpec,
      mattingResultInput,
      this.options.normalizationSpec,
      normalizationResultInput,
    );
    const spec = await this.#prepareSpec();
    const normalizedBytes = await Promise.all(normalizationResult.frameResults.map(({artifact}, frameIndex) => (
      this.#readNormalized(artifact.asset, frameIndex)
    )));
    const prepared: PreparedOutput[] = [];
    const batchOutputs = new Map<string, {bytes: Uint8Array; anchors: PoseAnchors; createdAt: string}>();
    for (const [frameIndex, normalizedFrame] of normalizationResult.frameResults.entries()) {
      const normalizedArtifact = normalizedFrame.artifact;
      const bytes = normalizedBytes[frameIndex]!;
      const required = requestInput.frames[frameIndex]!.spec.requiredAnchors;
      const cacheKey = await poseFrameStageCacheKey({
        stage: 'anchored',
        inputContentHash: normalizedArtifact.asset.contentHash,
        processorSpecHash: spec.processorSpecHash,
      });
      const anchorInputHash = await hashPoseClipAnchoringInput({
        normalizedArtifactHash: normalizedArtifact.outputHash,
        processorSpecHash: spec.processorSpecHash,
      });
      const batch = batchOutputs.get(cacheKey);
      if (batch !== undefined) {
        const anchors = this.#validateAnchors(batch.anchors, required, frameIndex);
        prepared.push({
          normalizedArtifact, bytes: batch.bytes.slice(), anchors, createdAt: batch.createdAt,
          cacheKey, anchorInputHash, cache: 'hit', attempts: 0,
        });
        continue;
      }
      const cached = await this.#stageCache.get(cacheKey);
      if (cached !== undefined) {
        const output = await this.#validateCached(
          cached, bytes, normalizedArtifact.asset, required, frameIndex,
        );
        batchOutputs.set(cacheKey, {
          bytes: output.bytes.slice(), anchors: structuredClone(output.anchors), createdAt: output.createdAt,
        });
        prepared.push({
          normalizedArtifact, ...output, cacheKey, anchorInputHash, cache: 'hit', attempts: 0,
        });
        continue;
      }
      const processed = await retry(`anchoring frame ${frameIndex}`, this.#maxAttempts, () => (
        this.options.processor.process({
          bytes: bytes.slice(),
          inputContentHash: normalizedArtifact.asset.contentHash,
          spec: structuredClone(spec),
        })
      ));
      const output = this.#validateOutput(
        processed.value.bytes,
        bytes,
        normalizedArtifact.asset,
        processed.value.anchors,
        required,
        frameIndex,
      );
      const createdAt = (this.options.now ?? (() => new Date()))().toISOString();
      batchOutputs.set(cacheKey, {
        bytes: output.bytes.slice(), anchors: structuredClone(output.anchors), createdAt,
      });
      prepared.push({
        normalizedArtifact, ...output, createdAt, cacheKey, anchorInputHash,
        cache: 'miss', attempts: processed.attempts,
      });
    }

    // All four anchor outputs are validated before the first Anchored CAS publication.
    const frameResults = [];
    const publishedCacheKeys = new Set<string>();
    for (const [frameIndex, output] of prepared.entries()) {
      const stored = await this.options.cas.putPng(output.bytes);
      if (output.cache === 'miss' && !publishedCacheKeys.has(output.cacheKey)) {
        await this.#stageCache.set(output.cacheKey, {
          bytes: stored.bytes,
          contentHash: stored.contentHash,
          width: output.normalizedArtifact.asset.width,
          height: output.normalizedArtifact.asset.height,
          alphaMode: 'straight',
          createdAt: output.createdAt,
          anchors: output.anchors,
        });
        publishedCacheKeys.add(output.cacheKey);
      }
      const normalizedFrame = normalizationResult.frameResults[frameIndex]!;
      const asset = ProductionVisualAssetSchema.parse({
        id: anchoredAssetId(output.normalizedArtifact.asset.id),
        uri: stored.uri,
        contentHash: stored.contentHash,
        source: 'generated',
        provenance: {
          inputHash: output.anchorInputHash,
          ...(spec.model === undefined ? {} : {modelId: spec.model.modelId}),
          producer: spec.processor,
          createdAt: output.createdAt,
        },
        qaStatus: 'pending',
        kind: output.normalizedArtifact.asset.kind,
        width: output.normalizedArtifact.asset.width,
        height: output.normalizedArtifact.asset.height,
        alphaMode: 'straight',
      });
      const artifactPayload = {
        stage: 'anchored' as const,
        inputHash: output.normalizedArtifact.outputHash,
        producer: spec.processor,
        asset,
      };
      const artifact = {...artifactPayload, outputHash: await hashPoseFrameArtifactPayload(artifactPayload)};
      const framePayload = {
        schemaVersion: '1.0.0' as const,
        frameJobHash: normalizedFrame.frameJobHash,
        frameIndex,
        frameSpecHash: normalizedFrame.frameSpecHash,
        generationInputHash: normalizedFrame.generationInputHash,
        normalizedArtifactHash: output.normalizedArtifact.outputHash,
        anchorInputHash: output.anchorInputHash,
        anchors: output.anchors,
        artifact,
      };
      frameResults.push({...framePayload, resultHash: await hashPoseClipAnchoredFrameResultPayload(framePayload)});
    }
    const payload = {
      schemaVersion: '1.0.0' as const,
      productionRequestHash: normalizationResult.productionRequestHash,
      normalizationResultHash: normalizationResult.resultHash,
      processorSpecHash: spec.processorSpecHash,
      frameResults,
      producer: ANCHORING_PRODUCER,
    };
    const result = await assertPoseClipAnchoringResultIntegrity(
      requestInput,
      rawResultInput,
      this.options.mattingSpec,
      mattingResultInput,
      this.options.normalizationSpec,
      normalizationResult,
      spec,
      {...payload, resultHash: await hashPoseClipAnchoringResultPayload(payload)},
    );
    return {
      result,
      frames: prepared.map((output, frameIndex) => ({
        frameIndex,
        cache: output.cache,
        attempts: output.attempts,
        cacheKey: output.cacheKey,
        anchorInputHash: output.anchorInputHash,
      })),
    };
  }
}
