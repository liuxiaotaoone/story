import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  createActionGenerationRequest,
  sha256Bytes,
  type ActionGenerationRequestPayload,
} from '@pose-clip/schemas';
import {
  AssetGenerationIntegrityError,
  ComfyUiProvider,
  inspectPng,
} from '../src/index.js';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1WzWQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);

const outputRoots: string[] = [];

afterEach(async () => {
  await Promise.all(outputRoots.splice(0).map(async (path) => rm(path, {recursive: true, force: true})));
});

async function fixture() {
  const workflow = new TextEncoder().encode(JSON.stringify({
    '1': {class_type: 'TestSampler', inputs: {
      prompt: '{{prompt}}', negative: '{{negativePrompt}}', seed: '{{seed}}', model: '{{modelId}}',
      reference: '{{reference:rabbit.reference}}',
    }},
    '2': {class_type: 'SaveImage', inputs: {images: ['1', 0], filename_prefix: '{{filenamePrefix}}'}},
  }));
  const referenceHash = await sha256Bytes(PNG);
  const payload: ActionGenerationRequestPayload = {
    schemaVersion: '1.0.0',
    actionPackageId: 'rabbit.idle',
    entityType: 'rabbit',
    action: 'idle',
    direction: 'left',
    workflowId: 'flux2-klein-single-frame-v1',
    workflowHash: await sha256Bytes(workflow),
    model: {provider: 'comfyui', modelId: 'flux-2-klein-4b-fp8.safetensors'},
    prompt: 'Whole-body paper-cut rabbit, facing left.',
    negativePrompt: 'cropped feet',
    seed: 42,
    referenceAssets: [{assetId: 'rabbit.reference', contentHash: referenceHash}],
    output: {assetId: 'rabbit.idle-left.01', kind: 'animal-frame'},
  };
  return {workflow, request: await createActionGenerationRequest(payload)};
}

describe('ComfyUI image generation provider', () => {
  it('materializes a hashed workflow and hashes the real returned PNG bytes into AssetRecord', async () => {
    const {workflow, request} = await fixture();
    const outputRoot = await mkdtemp(join(tmpdir(), 'pose-clip-comfyui-'));
    outputRoots.push(outputRoot);
    let queuedPrompt: Record<string, unknown> | undefined;

    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith('/upload/image')) {
        return new Response(JSON.stringify({name: 'rabbit-reference.png', subfolder: '', type: 'input'}));
      }
      if (url.pathname.endsWith('/prompt')) {
        const body = JSON.parse(String(init?.body)) as {prompt: Record<string, unknown>};
        queuedPrompt = body.prompt;
        return new Response(JSON.stringify({prompt_id: 'prompt-1'}));
      }
      if (url.pathname.endsWith('/history/prompt-1')) {
        return new Response(JSON.stringify({
          'prompt-1': {status: {status_str: 'success'}, outputs: {
            '2': {images: [{filename: 'rabbit.png', subfolder: 'pose-clip', type: 'output'}]},
          }},
        }));
      }
      if (url.pathname.endsWith('/view')) return new Response(PNG, {headers: {'content-type': 'image/png'}});
      return new Response('not found', {status: 404});
    };

    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188',
      outputRoot,
      workflowResolver: async () => workflow,
      referenceResolver: async () => ({bytes: PNG, filename: 'rabbit-reference.png'}),
      fetch: fetchMock,
      now: () => new Date('2026-08-13T12:00:00.000Z'),
      pollIntervalMs: 0,
      timeoutMs: 100,
    });
    const [artifact] = await provider.generate(request);

    expect(queuedPrompt).toEqual(expect.objectContaining({
      '1': {class_type: 'TestSampler', inputs: {
        prompt: request.prompt,
        negative: request.negativePrompt,
        seed: request.seed,
        model: request.model.modelId,
        reference: 'rabbit-reference.png',
      }},
    }));
    expect(artifact?.bytes).toEqual(PNG);
    expect(Uint8Array.from(await readFile(artifact!.filePath))).toEqual(PNG);
    expect(artifact?.asset).toEqual(expect.objectContaining({
      id: request.output.assetId,
      kind: 'animal-frame',
      contentHash: await sha256Bytes(PNG),
      width: 1,
      height: 1,
      alphaMode: 'straight',
      source: 'generated',
      qaStatus: 'pending',
      provenance: expect.objectContaining({inputHash: request.inputHash, seed: 42}),
    }));
  });

  it('fails before queueing when request or workflow content drifts', async () => {
    const {workflow, request} = await fixture();
    const outputRoot = await mkdtemp(join(tmpdir(), 'pose-clip-comfyui-'));
    outputRoots.push(outputRoot);
    let fetchCalls = 0;
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot,
      workflowResolver: async () => workflow,
      referenceResolver: async () => ({bytes: PNG}),
      fetch: async () => { fetchCalls += 1; return new Response(); },
    });
    await expect(provider.generate({...request, prompt: 'tampered'})).rejects.toMatchObject({
      code: 'GENERATION_REQUEST_HASH_MISMATCH',
    } satisfies Partial<AssetGenerationIntegrityError>);
    expect(fetchCalls).toBe(0);

    const drifted = new TextEncoder().encode('{}');
    const workflowDriftProvider = new ComfyUiProvider({...providerOptions(provider), workflowResolver: async () => drifted});
    await expect(workflowDriftProvider.generate(request)).rejects.toMatchObject({
      code: 'GENERATION_WORKFLOW_HASH_MISMATCH',
    } satisfies Partial<AssetGenerationIntegrityError>);
  });

  it('resumes a completed prompt only when History is bound to the same request hash', async () => {
    const {request} = await fixture();
    const outputRoot = await mkdtemp(join(tmpdir(), 'pose-clip-comfyui-'));
    outputRoots.push(outputRoot);
    const promptId = 'completed-prompt';
    const history = (clientId: string) => ({
      [promptId]: {
        prompt: [0, promptId, {}, {client_id: clientId}],
        status: {status_str: 'success', completed: true},
        outputs: {'2': {images: [{filename: 'rabbit.png', subfolder: '', type: 'output'}]}},
      },
    });
    let clientId = `pose-clip-${request.inputHash.slice(0, 16)}`;
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot,
      workflowResolver: async () => new Uint8Array(),
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith(`/history/${promptId}`)) return new Response(JSON.stringify(history(clientId)));
        if (url.pathname.endsWith('/view')) return new Response(PNG);
        return new Response('not found', {status: 404});
      },
      now: () => new Date('2026-08-13T12:00:00.000Z'),
    });
    expect((await provider.collectCompleted(request, promptId))[0]?.providerMetadata.promptId).toBe(promptId);

    clientId = 'another-request';
    await expect(provider.collectCompleted(request, promptId)).rejects.toMatchObject({
      code: 'GENERATION_PROMPT_BINDING_MISMATCH',
    } satisfies Partial<AssetGenerationIntegrityError>);
  });
});

function providerOptions(_provider: ComfyUiProvider) {
  return {
    endpoint: 'http://127.0.0.1:8188',
    outputRoot: outputRoots[0]!,
    referenceResolver: async () => ({bytes: PNG}),
    fetch: async () => new Response(),
  };
}

describe('PNG contract', () => {
  it('reads dimensions and alpha from actual PNG bytes', () => {
    expect(inspectPng(PNG)).toEqual({width: 1, height: 1, alphaMode: 'straight'});
    expect(() => inspectPng(new Uint8Array([1, 2, 3]))).toThrow(/readable PNG/);
  });
});
