import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ComfyUiProvider,
  LocalCasAssetByteResolver,
} from '@pose-clip/asset-generation';
import {
  TextureCache,
  VerifiedAssetResolver,
  type VerifiedAsset,
} from '@pose-clip/paper-pixi';
import {
  createActionGenerationRequest,
  sha256Bytes,
  type VisualAssetRecord,
} from '@pose-clip/schemas';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1WzWQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, {recursive: true, force: true})));
});

describe('ComfyUI to Renderer asset-resolution closure', () => {
  it('loads a provider artifact through Local CAS and verifies bytes before TextureLoader', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pose-clip-local-cas-'));
    roots.push(outputRoot);
    const workflow = new TextEncoder().encode(JSON.stringify({
      '1': {class_type: 'Sampler', inputs: {
        prompt: '{{prompt}}', seed: '{{seed}}', model: '{{runtimeModel:diffusion-model}}',
      }},
      '2': {class_type: 'SaveImage', inputs: {images: ['1', 0], filename_prefix: '{{filenamePrefix}}'}},
    }));
    const request = await createActionGenerationRequest({
      schemaVersion: '1.0.0', actionPackageId: 'rabbit.idle', entityType: 'rabbit',
      action: 'idle', direction: 'left', workflowId: 'test-workflow',
      workflowHash: await sha256Bytes(workflow), provider: 'comfyui',
      runtimeModels: [
        {role: 'diffusion-model', modelId: 'diffusion.safetensors', contentHash: '1'.repeat(64)},
        {role: 'text-encoder', modelId: 'encoder.safetensors', contentHash: '2'.repeat(64)},
        {role: 'vae', modelId: 'vae.safetensors', contentHash: '3'.repeat(64)},
      ],
      prompt: 'Whole-body rabbit facing left.', seed: 7, referenceAssets: [],
      output: {assetId: 'rabbit.idle-left.01', kind: 'animal-frame', nodeId: '2', expectedCount: 1},
    });
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot,
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) return new Response(JSON.stringify({prompt_id: 'closure-1'}));
        if (url.pathname.endsWith('/history/closure-1')) return new Response(JSON.stringify({
          'closure-1': {status: {status_str: 'success'}, outputs: {
            '2': {images: [{filename: 'raw.png', subfolder: '', type: 'output'}]},
          }},
        }));
        if (url.pathname.endsWith('/view')) return new Response(PNG, {headers: {'content-type': 'image/png'}});
        return new Response('not found', {status: 404});
      },
      now: () => new Date('2026-08-15T00:00:00.000Z'), pollIntervalMs: 0, timeoutMs: 100,
    });

    const [artifact] = await provider.generate(request);
    const localCas = new LocalCasAssetByteResolver(outputRoot);
    const texture = {identity: 'verified-texture'};
    const loader = vi.fn(async (
      _asset: Readonly<VisualAssetRecord>,
      _verified: Readonly<VerifiedAsset>,
    ) => texture as never);
    const cache = new TextureCache({
      resolver: new VerifiedAssetResolver((asset) => localCas.resolve(asset)),
      loader,
    });

    await cache.load(artifact!.asset);

    expect(artifact!.filePath).toBe(join(outputRoot, `${artifact!.asset.contentHash}.png`));
    expect(artifact!.asset.uri).toBe(`asset://sha256/${artifact!.asset.contentHash}`);
    expect(loader).toHaveBeenCalledOnce();
    expect(loader.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      assetId: artifact!.asset.id,
      contentHash: artifact!.asset.contentHash,
      bytes: PNG,
    }));
    expect(cache.get(artifact!.asset.id)).toBe(texture);
  });
});
