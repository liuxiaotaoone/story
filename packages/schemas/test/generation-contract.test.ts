import {describe, expect, it} from 'vitest';
import {
  ActionGenerationRequestSchema,
  actionGenerationRequestPayload,
  createActionGenerationRequest,
  hashActionGenerationRequestPayload,
} from '../src/index.js';

const HASH = '1'.repeat(64);

function payload() {
  return {
    schemaVersion: '1.0.0' as const,
    actionPackageId: 'rabbit.idle',
    entityType: 'rabbit',
    action: 'idle',
    direction: 'left' as const,
    workflowId: 'flux2-klein-single-frame-v1',
    workflowHash: HASH,
    provider: 'comfyui' as const,
    runtimeModels: [
      {role: 'diffusion-model' as const, modelId: 'flux-2.safetensors', contentHash: '3'.repeat(64)},
      {role: 'text-encoder' as const, modelId: 'qwen.safetensors', contentHash: '4'.repeat(64)},
      {role: 'vae' as const, modelId: 'flux2-vae.safetensors', contentHash: '5'.repeat(64)},
    ],
    prompt: 'A whole-body paper-cut rabbit, left-facing, transparent background.',
    negativePrompt: 'cropped feet, extra limbs',
    seed: 42,
    referenceAssets: [{assetId: 'rabbit.reference', contentHash: '2'.repeat(64)}],
    output: {assetId: 'rabbit.idle-left.01', kind: 'animal-frame' as const, nodeId: '17', expectedCount: 1 as const},
  };
}

describe('M3 generation request contract', () => {
  it('binds workflow, model, prompt, seed, references and output into inputHash', async () => {
    const request = await createActionGenerationRequest(payload());
    expect(request.inputHash).toBe(await hashActionGenerationRequestPayload(actionGenerationRequestPayload(request)));

    const variants = [
      {...payload(), workflowHash: '3'.repeat(64)},
      {...payload(), runtimeModels: payload().runtimeModels.map((model, index) => index === 0 ? {...model, contentHash: '6'.repeat(64)} : model)},
      {...payload(), prompt: 'A different prompt'},
      {...payload(), seed: 43},
      {...payload(), referenceAssets: [{assetId: 'rabbit.reference', contentHash: '5'.repeat(64)}]},
    ];
    for (const variant of variants) {
      expect((await createActionGenerationRequest(variant)).inputHash).not.toBe(request.inputHash);
    }
  });

  it('rejects duplicate reference asset identities', () => {
    const reference = payload().referenceAssets[0]!;
    expect(ActionGenerationRequestSchema.safeParse({
      ...payload(),
      referenceAssets: [reference, reference],
      inputHash: HASH,
    }).success).toBe(false);
  });

  it('requires unique runtime model roles and exact single-image output', () => {
    expect(ActionGenerationRequestSchema.safeParse({
      ...payload(),
      runtimeModels: [payload().runtimeModels[0]!, {...payload().runtimeModels[0]!, modelId: 'other.safetensors'}],
      inputHash: HASH,
    }).success).toBe(false);
    expect(ActionGenerationRequestSchema.safeParse({
      ...payload(), runtimeModels: [payload().runtimeModels[0]!], inputHash: HASH,
    }).success).toBe(false);
    expect(ActionGenerationRequestSchema.safeParse({
      ...payload(), output: {...payload().output, expectedCount: 2}, inputHash: HASH,
    }).success).toBe(false);
  });
});
