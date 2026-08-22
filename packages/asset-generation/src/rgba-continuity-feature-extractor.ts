import {
  PoseClipContinuityFrameFeaturesSchema,
  PoseClipContinuityIntegrityError,
  PoseClipFrameProductionResultSchema,
  assertPoseClipContinuityFeatureExtractorSpecIntegrity,
  hashPoseClipFrameProductionResultPayload,
  sha256Bytes,
  type PoseClipContinuityFeatureExtractorSpec,
  type PoseClipContinuityFrameFeatures,
  type PoseClipFrameProductionResult,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import type {
  PoseClipContinuityFeatureExtractor,
  PoseClipContinuityFeatureExtractorInput,
} from './pose-clip-continuity-evaluator.js';
import {decodeRgbaPng8} from './rgba-png.js';

export interface RgbaContinuityFeatureConfig {
  readonly alphaThreshold: number;
  readonly colorBins: number;
  readonly silhouetteGridSize: number;
}

export interface PoseClipContinuityAssetByteResolver {
  resolve(asset: Readonly<VisualAssetRecord>): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: 'image/png';
  }>;
}

interface ForegroundSummary {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly totalWeight: number;
  readonly upperWeight: number;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < minimum
    || value > maximum
  ) throw new PoseClipContinuityIntegrityError(
    'CONTINUITY_RGBA_CONFIG_INVALID',
    `${label} must be an integer from ${minimum} to ${maximum}`,
  );
  return value;
}

function parseConfig(spec: PoseClipContinuityFeatureExtractorSpec): RgbaContinuityFeatureConfig {
  const value = spec.config;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_RGBA_CONFIG_INVALID', 'RGBA continuity extractor requires an object config',
    );
  }
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).sort();
  const expected = ['alphaThreshold', 'colorBins', 'silhouetteGridSize'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_RGBA_CONFIG_INVALID', 'RGBA continuity config contains missing or unknown fields',
    );
  }
  return {
    alphaThreshold: integer(config.alphaThreshold, 'alphaThreshold', 1, 255),
    colorBins: integer(config.colorBins, 'colorBins', 2, 32),
    silhouetteGridSize: integer(config.silhouetteGridSize, 'silhouetteGridSize', 2, 32),
  };
}

function summarizeForeground(
  pixels: Uint8Array,
  width: number,
  height: number,
  alphaThreshold: number,
): ForegroundSummary {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let totalWeight = 0;
  const weightsByRow = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3]!;
      if (alpha < alphaThreshold) continue;
      const weight = alpha / 255;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      totalWeight += weight;
      weightsByRow[y]! += weight;
    }
  }
  if (maxX < minX || maxY < minY || totalWeight <= 0) throw new PoseClipContinuityIntegrityError(
    'CONTINUITY_RGBA_FOREGROUND_EMPTY', 'Anchored RGBA has no foreground at alphaThreshold',
  );
  const splitY = (minY + maxY + 1) / 2;
  const upperWeight = weightsByRow.reduce((total, weight, y) => (
    y + 0.5 < splitY ? total + weight : total
  ), 0);
  return {minX, minY, maxX, maxY, totalWeight, upperWeight};
}

function colorHistogram(
  pixels: Uint8Array,
  alphaThreshold: number,
  bins: number,
  totalWeight: number,
): number[] {
  const histogram = new Array<number>(bins * 3).fill(0);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3]!;
    if (alpha < alphaThreshold) continue;
    const weight = alpha / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const bin = Math.min(bins - 1, Math.floor(pixels[offset + channel]! * bins / 256));
      histogram[channel * bins + bin]! += weight;
    }
  }
  return histogram.map((value) => value / totalWeight);
}

function silhouetteGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  alphaThreshold: number,
  gridSize: number,
): number[] {
  const weights = new Array<number>(gridSize * gridSize).fill(0);
  const counts = new Array<number>(gridSize * gridSize).fill(0);
  for (let y = 0; y < height; y += 1) {
    const gridY = Math.min(gridSize - 1, Math.floor(y * gridSize / height));
    for (let x = 0; x < width; x += 1) {
      const gridX = Math.min(gridSize - 1, Math.floor(x * gridSize / width));
      const cell = gridY * gridSize + gridX;
      const alpha = pixels[(y * width + x) * 4 + 3]!;
      counts[cell]! += 1;
      if (alpha >= alphaThreshold) weights[cell]! += alpha / 255;
    }
  }
  return weights.map((weight, index) => (
    counts[index] === 0 ? 0 : weight / counts[index]!
  ));
}

/** Extracts deterministic, pixel-derived continuity features from Anchored RGBA CAS bytes. */
export class RgbaPoseClipContinuityFeatureExtractor implements PoseClipContinuityFeatureExtractor {
  readonly id = 'rgba-continuity-features';
  readonly version = '1.0.0';

  constructor(private readonly resolver: PoseClipContinuityAssetByteResolver) {}

  async extract(input: PoseClipContinuityFeatureExtractorInput): Promise<PoseClipContinuityFrameFeatures> {
    const spec = await assertPoseClipContinuityFeatureExtractorSpecIntegrity(input.spec);
    if (spec.extractor.name !== this.id || spec.extractor.version !== this.version) {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_EXTRACTOR_BINDING_MISMATCH',
        `Expected ${spec.extractor.name}@${spec.extractor.version}`,
      );
    }
    if (spec.model !== undefined) throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_RGBA_MODEL_UNEXPECTED', 'RGBA continuity extractor is algorithmic',
    );
    const config = parseConfig(spec);
    const frameResult = PoseClipFrameProductionResultSchema.parse(
      input.frameResult,
    ) as PoseClipFrameProductionResult;
    const {resultHash: _resultHash, ...framePayload} = frameResult;
    if (await hashPoseClipFrameProductionResultPayload(framePayload) !== frameResult.resultHash) {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_FRAME_RESULT_HASH_MISMATCH', `Frame ${frameResult.frameIndex}`,
      );
    }
    const asset = frameResult.artifacts[3]!.asset;
    let resolved: Awaited<ReturnType<PoseClipContinuityAssetByteResolver['resolve']>>;
    try {
      resolved = await this.resolver.resolve(asset);
    } catch (error) {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_ANCHORED_CAS_READ_FAILED', `Frame ${frameResult.frameIndex}: ${String(error)}`,
      );
    }
    const bytes = resolved.bytes.slice();
    if (await sha256Bytes(bytes) !== asset.contentHash) throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_ANCHORED_CONTENT_HASH_MISMATCH', `Frame ${frameResult.frameIndex}`,
    );
    let decoded: ReturnType<typeof decodeRgbaPng8>;
    try {
      decoded = decodeRgbaPng8(bytes);
    } catch (error) {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_ANCHORED_RGBA_INVALID', `Frame ${frameResult.frameIndex}: ${String(error)}`,
      );
    }
    if (decoded.width !== asset.width || decoded.height !== asset.height || asset.alphaMode !== 'straight') {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_ANCHORED_METADATA_MISMATCH', `Frame ${frameResult.frameIndex}`,
      );
    }
    const foreground = summarizeForeground(
      decoded.pixels, decoded.width, decoded.height, config.alphaThreshold,
    );
    const boundsWidth = foreground.maxX - foreground.minX + 1;
    const boundsHeight = foreground.maxY - foreground.minY + 1;
    const boundsArea = boundsWidth * boundsHeight;
    const feature = {
      frameIndex: frameResult.frameIndex,
      sourceContentHash: asset.contentHash,
      canvas: {width: decoded.width, height: decoded.height},
      subjectBounds: {
        x: foreground.minX / decoded.width,
        y: foreground.minY / decoded.height,
        width: boundsWidth / decoded.width,
        height: boundsHeight / decoded.height,
      },
      identityEmbedding: colorHistogram(
        decoded.pixels, config.alphaThreshold, config.colorBins, foreground.totalWeight,
      ),
      bodyProportions: [
        boundsWidth / decoded.width,
        boundsHeight / decoded.height,
        boundsWidth / (boundsWidth + boundsHeight),
        foreground.totalWeight / boundsArea,
        foreground.upperWeight / foreground.totalWeight,
      ],
      silhouetteEmbedding: silhouetteGrid(
        decoded.pixels,
        decoded.width,
        decoded.height,
        config.alphaThreshold,
        config.silhouetteGridSize,
      ),
    };
    return PoseClipContinuityFrameFeaturesSchema.parse(feature);
  }
}
