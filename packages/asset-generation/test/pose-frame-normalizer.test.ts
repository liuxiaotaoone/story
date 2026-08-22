import {describe, expect, it} from 'vitest';
import {
  createPoseFrameProcessorSpec,
  poseFrameStageCacheKey,
  sha256Bytes,
} from '@pose-clip/schemas';
import {
  CanonicalCanvasPoseFrameNormalizer,
  decodeRgbaPng8,
  encodeRgbaPng,
} from '../src/index.js';

async function normalize(input: {
  width: number;
  height: number;
  pixels: Uint8Array;
  canvasWidth: number;
  canvasHeight: number;
  targetForegroundHeight: number;
  maxForegroundWidth: number;
}) {
  const bytes = encodeRgbaPng({width: input.width, height: input.height, pixels: input.pixels});
  const spec = await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'normalized',
    processor: {name: 'canonical-canvas-normalize', version: '1.0.1'},
    config: {
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
      targetForegroundHeight: input.targetForegroundHeight,
      maxForegroundWidth: input.maxForegroundWidth,
      bottomPadding: 0,
      alphaThreshold: 1,
      resampling: 'bilinear-premultiplied',
    },
  });
  const output = await new CanonicalCanvasPoseFrameNormalizer().process({
    bytes,
    inputContentHash: await sha256Bytes(bytes),
    spec,
  });
  return decodeRgbaPng8(output.bytes);
}

function pixel(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

describe('M4 Commit 3.1 Normalize Pixel & Identity Closure', () => {
  it('changes processor identity and stage cache key for the corrected sampler', async () => {
    const config = {
      canvasWidth: 4,
      canvasHeight: 4,
      targetForegroundHeight: 4,
      maxForegroundWidth: 4,
      bottomPadding: 0,
      alphaThreshold: 1,
      resampling: 'bilinear-premultiplied',
    } as const;
    const previousSpec = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'normalized',
      processor: {name: 'canonical-canvas-normalize', version: '1.0.0'},
      config,
    });
    const correctedSpec = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'normalized',
      processor: {name: 'canonical-canvas-normalize', version: '1.0.1'},
      config,
    });
    const inputContentHash = 'a'.repeat(64);
    const previousCacheKey = await poseFrameStageCacheKey({
      stage: 'normalized',
      inputContentHash,
      processorSpecHash: previousSpec.processorSpecHash,
    });
    const correctedCacheKey = await poseFrameStageCacheKey({
      stage: 'normalized',
      inputContentHash,
      processorSpecHash: correctedSpec.processorSpecHash,
    });

    expect(new CanonicalCanvasPoseFrameNormalizer().version).toBe('1.0.1');
    expect(correctedSpec.processorSpecHash).not.toBe(previousSpec.processorSpecHash);
    expect(correctedCacheKey).not.toBe(previousCacheKey);
  });

  it('uses clamp-to-edge weights when horizontally upscaling RED | BLUE', async () => {
    const output = await normalize({
      width: 2,
      height: 1,
      pixels: Uint8Array.from([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
      canvasWidth: 4,
      canvasHeight: 2,
      targetForegroundHeight: 2,
      maxForegroundWidth: 4,
    });
    expect(Array.from(output.pixels.slice(0, 16))).toEqual([
      255, 0, 0, 255,
      191, 0, 64, 255,
      64, 0, 191, 255,
      0, 0, 255, 255,
    ]);
  });

  it('preserves all four source corners when upscaling a 2x2 image to 4x4', async () => {
    const output = await normalize({
      width: 2,
      height: 2,
      pixels: Uint8Array.from([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 255, 255,
      ]),
      canvasWidth: 4,
      canvasHeight: 4,
      targetForegroundHeight: 4,
      maxForegroundWidth: 4,
    });
    expect(pixel(output.pixels, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(output.pixels, 4, 3, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(output.pixels, 4, 0, 3)).toEqual([0, 0, 255, 255]);
    expect(pixel(output.pixels, 4, 3, 3)).toEqual([255, 255, 255, 255]);
  });

  it('prevents transparent BLUE RGB from contaminating an opaque RED edge', async () => {
    const output = await normalize({
      width: 3,
      height: 1,
      pixels: Uint8Array.from([
        255, 0, 0, 255,
        0, 0, 255, 0,
        255, 0, 0, 255,
      ]),
      canvasWidth: 6,
      canvasHeight: 2,
      targetForegroundHeight: 2,
      maxForegroundWidth: 6,
    });
    expect(Array.from({length: 6}, (_, x) => pixel(output.pixels, 6, x, 0))).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 191],
      [255, 0, 0, 64],
      [255, 0, 0, 64],
      [255, 0, 0, 191],
      [255, 0, 0, 255],
    ]);
  });
});
