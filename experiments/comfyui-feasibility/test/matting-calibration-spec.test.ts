import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {BorderConnectedChromaKeyPoseFrameMattingProcessor} from '@pose-clip/asset-generation';
import {createPoseFrameProcessorSpec} from '@pose-clip/schemas';

describe('M4 Commit 8.2 matting calibration candidate identity', () => {
  it('binds the checked-in candidate spec to chroma-key-matting 1.1.0', async () => {
    const input = JSON.parse(new TextDecoder().decode(await readFile(new URL(
      '../calibration/chroma-key-matting-border-candidate-v1.json',
      import.meta.url,
    )))) as Parameters<typeof createPoseFrameProcessorSpec>[0];
    const spec = await createPoseFrameProcessorSpec(input);
    const processor = new BorderConnectedChromaKeyPoseFrameMattingProcessor();

    expect({name: processor.id, version: processor.version, stage: processor.stage}).toEqual({
      name: spec.processor.name,
      version: spec.processor.version,
      stage: spec.stage,
    });
    expect(spec.processorSpecHash).toBe('3aff6579a10a1b922e592f9990ac71656ee043e6f1c6c91fb66acffeb91df64f');
  });
});
