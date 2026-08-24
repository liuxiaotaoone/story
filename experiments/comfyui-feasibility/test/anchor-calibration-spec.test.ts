import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {BilateralAlphaGeometryPoseFrameAnchorDetector} from '@pose-clip/asset-generation';
import {createPoseFrameProcessorSpec} from '@pose-clip/schemas';

describe('M4 Commit 8.3 bilateral foot anchor candidate identity', () => {
  it('binds the checked-in candidate spec to alpha-geometry-anchor 1.1.0', async () => {
    const input = JSON.parse(new TextDecoder().decode(await readFile(new URL(
      '../calibration/alpha-geometry-anchor-bilateral-candidate-v1.json',
      import.meta.url,
    )))) as Parameters<typeof createPoseFrameProcessorSpec>[0];
    const spec = await createPoseFrameProcessorSpec(input);
    const processor = new BilateralAlphaGeometryPoseFrameAnchorDetector();

    expect({name: processor.id, version: processor.version, stage: processor.stage}).toEqual({
      name: spec.processor.name,
      version: spec.processor.version,
      stage: spec.stage,
    });
    expect(spec.processorSpecHash).toBe('2eafcb0e7ac5fcef84296c34615d429f6fc9ace1efae3c707179b515cb6703b9');
  });
});
