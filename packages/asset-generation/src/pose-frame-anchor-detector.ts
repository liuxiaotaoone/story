import type {PoseAnchors} from '@pose-clip/schemas';
import {
  PoseFrameProcessorContractError,
  type PoseFrameProcessor,
  type PoseFrameProcessorInput,
  type PoseFrameProcessorOutput,
} from './pose-frame-processor.js';
import {decodeRgbaPng8} from './rgba-png.js';

export interface AlphaGeometryAnchorConfig {
  readonly alphaThreshold: number;
  readonly footBandHeight: number;
}

interface ForegroundPixel {
  readonly x: number;
  readonly y: number;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new PoseFrameProcessorContractError(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function parseConfig(value: unknown): AlphaGeometryAnchorConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PoseFrameProcessorContractError('Alpha Geometry Anchor requires an object config');
  }
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).sort();
  const expected = ['alphaThreshold', 'footBandHeight'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new PoseFrameProcessorContractError('Alpha Geometry Anchor config contains missing or unknown fields');
  }
  const parsed = {
    alphaThreshold: integer(config.alphaThreshold, 'alphaThreshold', 1),
    footBandHeight: integer(config.footBandHeight, 'footBandHeight', 1),
  };
  if (parsed.alphaThreshold > 255) throw new PoseFrameProcessorContractError('alphaThreshold must be <= 255');
  return parsed;
}

function deepestSupport(
  pixels: readonly ForegroundPixel[],
  width: number,
  height: number,
): {x: number; y: number} {
  const maximumY = Math.max(...pixels.map(({y}) => y));
  const row = pixels.filter(({y}) => y === maximumY);
  const meanX = row.reduce((total, {x}) => total + x + 0.5, 0) / row.length;
  return {x: meanX / width, y: (maximumY + 1) / height};
}

function detectAnchors(
  bytes: Uint8Array,
  config: AlphaGeometryAnchorConfig,
): PoseAnchors {
  const decoded = decodeRgbaPng8(bytes);
  const foreground: ForegroundPixel[] = [];
  let minX = decoded.width;
  let minY = decoded.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      if (decoded.pixels[(y * decoded.width + x) * 4 + 3]! < config.alphaThreshold) continue;
      foreground.push({x, y});
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (foreground.length === 0) throw new PoseFrameProcessorContractError(
    'Alpha Geometry Anchor input has no foreground pixels at alphaThreshold',
  );
  const bandStart = Math.max(minY, maxY - config.footBandHeight + 1);
  const footBand = foreground.filter(({y}) => y >= bandStart);
  const splitX = (minX + maxX + 1) / 2;
  const leftCandidates = footBand.filter(({x}) => x + 0.5 < splitX);
  const rightCandidates = footBand.filter(({x}) => x + 0.5 > splitX);
  const foot = deepestSupport(footBand, decoded.width, decoded.height);
  const leftFoot = leftCandidates.length === 0
    ? undefined
    : deepestSupport(leftCandidates, decoded.width, decoded.height);
  const rightFoot = rightCandidates.length === 0
    ? undefined
    : deepestSupport(rightCandidates, decoded.width, decoded.height);
  return {
    center: {
      x: (minX + maxX + 1) / (2 * decoded.width),
      y: (minY + maxY + 1) / (2 * decoded.height),
    },
    ...(leftFoot === undefined ? {} : {leftFoot}),
    ...(rightFoot === undefined ? {} : {rightFoot}),
    foot,
  };
}

/** Deterministically derives canonical pose anchors from a Normalized RGBA silhouette. */
export class AlphaGeometryPoseFrameAnchorDetector implements PoseFrameProcessor {
  readonly id = 'alpha-geometry-anchor';
  readonly version = '1.0.1';
  readonly stage = 'anchored' as const;

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    if (
      input.spec.stage !== this.stage
      || input.spec.processor.name !== this.id
      || input.spec.processor.version !== this.version
    ) throw new PoseFrameProcessorContractError('Alpha Geometry Anchor processor binding is invalid');
    if (input.spec.model !== undefined) throw new PoseFrameProcessorContractError(
      'Alpha Geometry Anchor is algorithmic and does not accept a model identity',
    );
    return {
      bytes: input.bytes.slice(),
      anchors: detectAnchors(input.bytes, parseConfig(input.spec.config)),
    };
  }
}
