import {describe, expect, it} from 'vitest';
import {
  createPoseFrameProcessorSpec,
  hashPoseClipMattingInput,
  poseFrameStageCacheKey,
} from '@pose-clip/schemas';
import {
  BorderConnectedChromaKeyPoseFrameMattingProcessor,
  ChromaKeyPoseFrameMattingProcessor,
  decodeRgbaPng8,
  encodeRgbaPng,
} from '../src/index.js';

const WIDTH = 11;
const HEIGHT = 11;

function fixturePixels(): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    const offset = index * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 120;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  }
  for (let y = 3; y <= 8; y += 1) {
    for (let x = 4; x <= 6; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = 240;
      pixels[offset + 1] = 220;
      pixels[offset + 2] = 200;
    }
  }
  // An enclosed green marking belongs to the subject and is not border-connected.
  const marking = (5 * WIDTH + 5) * 4;
  pixels[marking] = 0;
  pixels[marking + 1] = 120;
  pixels[marking + 2] = 0;
  // A mildly green-contaminated boundary pixel survives segmentation but should be de-spilled.
  const contaminatedEdge = (4 * WIDTH + 4) * 4;
  pixels[contaminatedEdge] = 100;
  pixels[contaminatedEdge + 1] = 120;
  pixels[contaminatedEdge + 2] = 100;
  // A four-pixel detached whisker sits close to the primary subject.
  for (let y = 5; y <= 8; y += 1) {
    const offset = (y * WIDTH + 1) * 4;
    pixels[offset] = 20;
    pixels[offset + 1] = 20;
    pixels[offset + 2] = 20;
  }
  // A distant non-green paper fleck must not enlarge the subject bounds.
  const fleck = (1 * WIDTH + 9) * 4;
  pixels[fleck] = 240;
  pixels[fleck + 1] = 240;
  pixels[fleck + 2] = 240;
  return pixels;
}

async function baselineSpec() {
  return createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'matted',
    processor: {name: 'chroma-key-matting', version: '1.0.0'},
    config: {
      keyColor: [0, 255, 0],
      transparentThreshold: 0.04,
      opaqueThreshold: 0.22,
      spillSuppression: 1,
    },
  });
}

async function candidateSpec(changes: Record<string, unknown> = {}) {
  return createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'matted',
    processor: {name: 'chroma-key-matting', version: '1.1.0'},
    config: {
      keyColor: [0, 255, 0],
      transparentThreshold: 0.04,
      opaqueThreshold: 0.22,
      spillSuppression: 1,
      borderCleanup: {
        alphaThreshold: 8,
        borderInset: 1,
        connectivity: 8,
        edgeSpillRadius: 1,
        greenMinimum: 64,
        greenDominance: 24,
        retainNearSubjectPx: 2,
        minimumComponentPixels: 4,
        ...changes,
      },
    },
  });
}

function alphaAt(pixels: Uint8Array, x: number, y: number): number {
  return pixels[(y * WIDTH + x) * 4 + 3]!;
}

describe('border-connected chroma-key matting 1.1.0', () => {
  it('removes connected dark-green background while retaining the primary subject and nearby whisker', async () => {
    const bytes = encodeRgbaPng({width: WIDTH, height: HEIGHT, pixels: fixturePixels()});
    const baseline = decodeRgbaPng8((await new ChromaKeyPoseFrameMattingProcessor().process({
      bytes,
      inputContentHash: 'a'.repeat(64),
      spec: await baselineSpec(),
    })).bytes).pixels;
    expect(alphaAt(baseline, 0, 0)).toBe(255);

    const candidate = decodeRgbaPng8((await new BorderConnectedChromaKeyPoseFrameMattingProcessor().process({
      bytes,
      inputContentHash: 'a'.repeat(64),
      spec: await candidateSpec(),
    })).bytes).pixels;
    expect(alphaAt(candidate, 0, 0)).toBe(0);
    expect(alphaAt(candidate, 9, 1)).toBe(0);
    expect(alphaAt(candidate, 5, 4)).toBe(255);
    expect(alphaAt(candidate, 5, 5)).toBe(255);
    expect(alphaAt(candidate, 1, 6)).toBe(255);
    expect(candidate[(4 * WIDTH + 4) * 4 + 1]).toBe(100);
    expect(candidate[(5 * WIDTH + 5) * 4 + 1]).toBe(120);
  });

  it('binds the capability upgrade to processor version and config identity', async () => {
    const baseline = await baselineSpec();
    const candidate = await candidateSpec();
    const changed = await candidateSpec({greenDominance: 30});
    expect(candidate.processor.version).toBe('1.1.0');
    expect(candidate.processorSpecHash).not.toBe(baseline.processorSpecHash);
    expect(changed.processorSpecHash).not.toBe(candidate.processorSpecHash);
    await expect(poseFrameStageCacheKey({
      stage: 'matted', inputContentHash: 'a'.repeat(64), processorSpecHash: candidate.processorSpecHash,
    })).resolves.not.toBe(await poseFrameStageCacheKey({
      stage: 'matted', inputContentHash: 'a'.repeat(64), processorSpecHash: baseline.processorSpecHash,
    }));
    await expect(hashPoseClipMattingInput({
      rawArtifactHash: 'b'.repeat(64), processorSpecHash: candidate.processorSpecHash,
    })).resolves.not.toBe(await hashPoseClipMattingInput({
      rawArtifactHash: 'b'.repeat(64), processorSpecHash: baseline.processorSpecHash,
    }));

    const bytes = encodeRgbaPng({width: WIDTH, height: HEIGHT, pixels: fixturePixels()});
    await expect(new BorderConnectedChromaKeyPoseFrameMattingProcessor().process({
      bytes,
      inputContentHash: 'a'.repeat(64),
      spec: baseline,
    })).rejects.toThrow(/processor binding is invalid/u);

    const processor = new BorderConnectedChromaKeyPoseFrameMattingProcessor();
    const first = await processor.process({bytes, inputContentHash: 'a'.repeat(64), spec: candidate});
    const repeated = await processor.process({bytes, inputContentHash: 'a'.repeat(64), spec: candidate});
    expect(repeated.bytes).toEqual(first.bytes);
  });

  it('fails closed for malformed cleanup configuration', async () => {
    const bytes = encodeRgbaPng({width: WIDTH, height: HEIGHT, pixels: fixturePixels()});
    await expect(new BorderConnectedChromaKeyPoseFrameMattingProcessor().process({
      bytes,
      inputContentHash: 'a'.repeat(64),
      spec: await candidateSpec({connectivity: 6}),
    })).rejects.toThrow('borderCleanup.connectivity must be 4 or 8');
  });
});
