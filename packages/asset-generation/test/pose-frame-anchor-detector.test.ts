import {describe, expect, it} from 'vitest';
import {
  anchoredAssetId,
  createPoseFrameProcessorSpec,
  poseFrameStageCacheKey,
  sha256Bytes,
} from '@pose-clip/schemas';
import {
  AlphaGeometryPoseFrameAnchorDetector,
  encodeRgbaPng,
} from '../src/index.js';

async function anchoringSpec() {
  return createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'anchored',
    processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
    config: {alphaThreshold: 1, footBandHeight: 2},
  });
}

describe('M4 Commit 4.1 Anchor Production Closure', () => {
  it('restores the M3 final Asset ID and rejects a non-Normalized identity', () => {
    expect(anchoredAssetId('rabbit.run.0.normalized')).toBe('rabbit.run.0');
    expect(() => anchoredAssetId('rabbit.run.0')).toThrow(
      'Anchoring input asset must use .normalized identity',
    );
  });

  it('changes Processor Spec and Stage Cache identity for the fail-closed foot detector', async () => {
    const config = {alphaThreshold: 1, footBandHeight: 2};
    const previousSpec = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'anchored',
      processor: {name: 'alpha-geometry-anchor', version: '1.0.0'},
      config,
    });
    const correctedSpec = await anchoringSpec();
    const inputContentHash = 'a'.repeat(64);
    const previousCacheKey = await poseFrameStageCacheKey({
      stage: 'anchored', inputContentHash, processorSpecHash: previousSpec.processorSpecHash,
    });
    const correctedCacheKey = await poseFrameStageCacheKey({
      stage: 'anchored', inputContentHash, processorSpecHash: correctedSpec.processorSpecHash,
    });

    expect(new AlphaGeometryPoseFrameAnchorDetector().version).toBe('1.0.1');
    expect(correctedSpec.processorSpecHash).not.toBe(previousSpec.processorSpecHash);
    expect(correctedCacheKey).not.toBe(previousCacheKey);
  });

  it('derives deterministic center and support anchors without changing Normalized bytes', async () => {
    const width = 6;
    const height = 6;
    const pixels = new Uint8Array(width * height * 4);
    for (const [x, y] of [
      [2, 1], [3, 1],
      [2, 2], [3, 2],
      [1, 3], [2, 3], [3, 3], [4, 3],
      [1, 4], [2, 4], [3, 4], [4, 4],
    ]) {
      const offset = (y! * width + x!) * 4;
      pixels.set([200, 100, 50, 255], offset);
    }
    const bytes = encodeRgbaPng({width, height, pixels});
    const output = await new AlphaGeometryPoseFrameAnchorDetector().process({
      bytes,
      inputContentHash: await sha256Bytes(bytes),
      spec: await anchoringSpec(),
    });

    expect(output.bytes).toEqual(bytes);
    expect(output.anchors).toEqual({
      center: {x: 0.5, y: 0.5},
      leftFoot: {x: 1 / 3, y: 5 / 6},
      rightFoot: {x: 2 / 3, y: 5 / 6},
      foot: {x: 0.5, y: 5 / 6},
    });
  });

  it('leaves the missing screen-right support undefined instead of copying the left foot', async () => {
    const width = 6;
    const height = 6;
    const pixels = new Uint8Array(width * height * 4);
    for (const [x, y] of [
      [2, 0], [3, 0], [2, 1], [3, 1],
      [1, 2], [2, 2], [3, 2], [4, 2],
      [1, 3], [2, 3], [4, 3],
      [1, 4], [2, 4], [1, 5], [2, 5],
    ]) {
      pixels[(y! * width + x!) * 4 + 3] = 255;
    }
    const bytes = encodeRgbaPng({width, height, pixels});
    const spec = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'anchored',
      processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
      config: {alphaThreshold: 1, footBandHeight: 1},
    });
    const output = await new AlphaGeometryPoseFrameAnchorDetector().process({
      bytes, inputContentHash: await sha256Bytes(bytes), spec,
    });

    expect(output.anchors).toMatchObject({
      foot: {x: 1 / 3, y: 1},
      leftFoot: {x: 1 / 3, y: 1},
    });
    expect(output.anchors?.rightFoot).toBeUndefined();
  });

  it('fails closed when the configured Alpha threshold finds no foreground', async () => {
    const bytes = encodeRgbaPng({width: 1, height: 1, pixels: Uint8Array.from([0, 0, 0, 64])});
    const spec = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'anchored',
      processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
      config: {alphaThreshold: 128, footBandHeight: 1},
    });
    await expect(new AlphaGeometryPoseFrameAnchorDetector().process({
      bytes,
      inputContentHash: await sha256Bytes(bytes),
      spec,
    })).rejects.toThrow('no foreground pixels');
  });
});
