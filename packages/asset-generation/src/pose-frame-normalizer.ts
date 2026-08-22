import type {
  PixelBounds,
  PoseFrameNormalizationTransform,
} from '@pose-clip/schemas';
import {
  PoseFrameProcessorContractError,
  type PoseFrameProcessor,
  type PoseFrameProcessorInput,
  type PoseFrameProcessorOutput,
} from './pose-frame-processor.js';
import {decodeRgbaPng8, encodeRgbaPng} from './rgba-png.js';

export interface CanonicalCanvasNormalizationConfig {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly targetForegroundHeight: number;
  readonly maxForegroundWidth: number;
  readonly bottomPadding: number;
  readonly alphaThreshold: number;
  readonly resampling: 'bilinear-premultiplied';
}

export interface PoseFrameNormalizer extends PoseFrameProcessor {
  readonly stage: 'normalized';
  plan(input: PoseFrameProcessorInput): Promise<PoseFrameNormalizationTransform>;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new PoseFrameProcessorContractError(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function parseConfig(value: unknown): CanonicalCanvasNormalizationConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PoseFrameProcessorContractError('Canonical Canvas Normalize requires an object config');
  }
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).sort();
  const expected = [
    'alphaThreshold', 'bottomPadding', 'canvasHeight', 'canvasWidth',
    'maxForegroundWidth', 'resampling', 'targetForegroundHeight',
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new PoseFrameProcessorContractError('Canonical Canvas Normalize config contains missing or unknown fields');
  }
  const parsed = {
    canvasWidth: integer(config.canvasWidth, 'canvasWidth', 1),
    canvasHeight: integer(config.canvasHeight, 'canvasHeight', 1),
    targetForegroundHeight: integer(config.targetForegroundHeight, 'targetForegroundHeight', 1),
    maxForegroundWidth: integer(config.maxForegroundWidth, 'maxForegroundWidth', 1),
    bottomPadding: integer(config.bottomPadding, 'bottomPadding', 0),
    alphaThreshold: integer(config.alphaThreshold, 'alphaThreshold', 1),
    resampling: config.resampling,
  };
  if (parsed.alphaThreshold > 255) throw new PoseFrameProcessorContractError('alphaThreshold must be <= 255');
  if (parsed.resampling !== 'bilinear-premultiplied') throw new PoseFrameProcessorContractError(
    'Canonical Canvas Normalize requires bilinear-premultiplied resampling',
  );
  if (parsed.maxForegroundWidth > parsed.canvasWidth) throw new PoseFrameProcessorContractError(
    'maxForegroundWidth must fit inside canvasWidth',
  );
  if (parsed.targetForegroundHeight + parsed.bottomPadding > parsed.canvasHeight) {
    throw new PoseFrameProcessorContractError('targetForegroundHeight plus bottomPadding must fit inside canvasHeight');
  }
  return parsed as CanonicalCanvasNormalizationConfig;
}

function foregroundBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  alphaThreshold: number,
): PixelBounds {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new PoseFrameProcessorContractError(
    'Canonical Canvas Normalize input has no foreground pixels at alphaThreshold',
  );
  return {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

function normalizationPlan(
  input: ReturnType<typeof decodeRgbaPng8>,
  config: CanonicalCanvasNormalizationConfig,
): PoseFrameNormalizationTransform {
  const sourceBounds = foregroundBounds(input.pixels, input.width, input.height, config.alphaThreshold);
  const scale = Math.min(
    config.targetForegroundHeight / sourceBounds.height,
    config.maxForegroundWidth / sourceBounds.width,
  );
  const width = Math.max(1, Math.round(sourceBounds.width * scale));
  const height = Math.max(1, Math.round(sourceBounds.height * scale));
  const destinationBounds = {
    x: Math.floor((config.canvasWidth - width) / 2),
    y: config.canvasHeight - config.bottomPadding - height,
    width,
    height,
  };
  return {
    sourceBounds,
    destinationBounds,
    canvas: {width: config.canvasWidth, height: config.canvasHeight},
    scale,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function samplePremultiplied(
  pixels: Uint8Array,
  imageWidth: number,
  bounds: PixelBounds,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const maximumX = bounds.x + bounds.width - 1;
  const maximumY = bounds.y + bounds.height - 1;
  const clampedX = clamp(x, bounds.x, maximumX);
  const clampedY = clamp(y, bounds.y, maximumY);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(x0 + 1, maximumX);
  const y1 = Math.min(y0 + 1, maximumY);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const weights = [
    [(1 - tx) * (1 - ty), x0, y0],
    [tx * (1 - ty), x1, y0],
    [(1 - tx) * ty, x0, y1],
    [tx * ty, x1, y1],
  ] as const;
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const [weight, sampleX, sampleY] of weights) {
    const offset = (sampleY * imageWidth + sampleX) * 4;
    const sampleAlpha = pixels[offset + 3]! / 255;
    alpha += sampleAlpha * weight;
    red += pixels[offset]! * sampleAlpha * weight;
    green += pixels[offset + 1]! * sampleAlpha * weight;
    blue += pixels[offset + 2]! * sampleAlpha * weight;
  }
  if (alpha <= 0) return [0, 0, 0, 0];
  return [red / alpha, green / alpha, blue / alpha, alpha * 255];
}

function renderNormalized(
  input: ReturnType<typeof decodeRgbaPng8>,
  transform: PoseFrameNormalizationTransform,
): Uint8Array {
  const output = new Uint8Array(transform.canvas.width * transform.canvas.height * 4);
  const source = transform.sourceBounds;
  const destination = transform.destinationBounds;
  for (let y = 0; y < destination.height; y += 1) {
    for (let x = 0; x < destination.width; x += 1) {
      const sourceX = source.x + (x + 0.5) * source.width / destination.width - 0.5;
      const sourceY = source.y + (y + 0.5) * source.height / destination.height - 0.5;
      const sample = samplePremultiplied(input.pixels, input.width, source, sourceX, sourceY);
      const offset = (
        (destination.y + y) * transform.canvas.width + destination.x + x
      ) * 4;
      output[offset] = Math.round(sample[0]);
      output[offset + 1] = Math.round(sample[1]);
      output[offset + 2] = Math.round(sample[2]);
      output[offset + 3] = Math.round(sample[3]);
    }
  }
  return encodeRgbaPng({width: transform.canvas.width, height: transform.canvas.height, pixels: output});
}

export class CanonicalCanvasPoseFrameNormalizer implements PoseFrameNormalizer {
  readonly id = 'canonical-canvas-normalize';
  readonly version = '1.0.1';
  readonly stage = 'normalized' as const;

  #assertBinding(input: PoseFrameProcessorInput): CanonicalCanvasNormalizationConfig {
    if (
      input.spec.stage !== this.stage
      || input.spec.processor.name !== this.id
      || input.spec.processor.version !== this.version
    ) throw new PoseFrameProcessorContractError('Canonical Canvas Normalize processor binding is invalid');
    if (input.spec.model !== undefined) throw new PoseFrameProcessorContractError(
      'Canonical Canvas Normalize is algorithmic and does not accept a model identity',
    );
    return parseConfig(input.spec.config);
  }

  async plan(input: PoseFrameProcessorInput): Promise<PoseFrameNormalizationTransform> {
    const config = this.#assertBinding(input);
    return normalizationPlan(decodeRgbaPng8(input.bytes), config);
  }

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    const config = this.#assertBinding(input);
    const decoded = decodeRgbaPng8(input.bytes);
    return {bytes: renderNormalized(decoded, normalizationPlan(decoded, config))};
  }
}
