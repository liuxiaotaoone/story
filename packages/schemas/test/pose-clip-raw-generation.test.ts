import {describe, expect, it} from 'vitest';
import {
  assertPoseClipRawGenerationResultIntegrity,
  contentAddressedAssetUri,
  createPoseClipRawGenerationResult,
  hashPoseClipRawFrameGenerationResultPayload,
  hashPoseFrameArtifactPayload,
} from '../src/index.js';

const PRODUCER = {name: 'raw-generation-fixture', version: '1.0.0'} as const;

async function rawResult() {
  const frameResults = [];
  for (let index = 0; index < 2; index += 1) {
    const generationInputHash = `${index + 1}`.repeat(64);
    const contentHash = `${index + 3}`.repeat(64);
    const artifactPayload = {
      stage: 'raw' as const,
      inputHash: generationInputHash,
      producer: PRODUCER,
      asset: {
        id: `rabbit.run.${index}`,
        uri: contentAddressedAssetUri(contentHash),
        contentHash,
        source: 'generated' as const,
        provenance: {
          inputHash: generationInputHash,
          promptHash: 'a'.repeat(64),
          seed: index,
          producer: PRODUCER,
          createdAt: '2026-08-18T00:00:00.000Z',
        },
        qaStatus: 'pending' as const,
        kind: 'animal-frame' as const,
        width: 1,
        height: 1,
        alphaMode: 'straight' as const,
      },
    };
    const artifact = {
      ...artifactPayload,
      outputHash: await hashPoseFrameArtifactPayload(artifactPayload),
    };
    const framePayload = {
      schemaVersion: '1.0.0' as const,
      frameJobHash: `${index + 5}`.repeat(64),
      frameIndex: index,
      frameSpecHash: `${index + 7}`.repeat(64),
      generationInputHash,
      artifact,
    };
    frameResults.push({
      ...framePayload,
      resultHash: await hashPoseClipRawFrameGenerationResultPayload(framePayload),
    });
  }
  return createPoseClipRawGenerationResult({
    schemaVersion: '1.0.0',
    productionRequestHash: 'f'.repeat(64),
    frameResults,
    producer: PRODUCER,
  });
}

describe('M4 Commit 1 raw generation contract', () => {
  it('binds ordered raw frame evidence and top-level result hash', async () => {
    const result = await rawResult();
    await expect(assertPoseClipRawGenerationResultIntegrity(undefined, result)).resolves.toEqual(result);
    const tampered = {...result, frameResults: [...result.frameResults].reverse()};
    await expect(assertPoseClipRawGenerationResultIntegrity(undefined, tampered)).rejects.toMatchObject({
      code: 'RAW_GENERATION_FRAME_ORDER_INVALID',
    });
  });

  it('rejects a non-raw or detached artifact before it can become a generation result', async () => {
    const result = await rawResult();
    const artifact = {...result.frameResults[0]!.artifact, inputHash: 'e'.repeat(64)};
    const frameResults = [{...result.frameResults[0]!, artifact}, result.frameResults[1]!];
    await expect(assertPoseClipRawGenerationResultIntegrity(undefined, {
      ...result,
      frameResults,
    })).rejects.toThrow();
  });
});
