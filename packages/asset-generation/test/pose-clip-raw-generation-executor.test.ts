import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  ProductionVisualAssetSchema,
  contentAddressedAssetUri,
  createActionGenerationRequest,
  createPoseClipFrameJob,
  createPoseClipFrameSpec,
  createPoseClipProductionRequest,
  sha256Bytes,
  type PoseClipFrameJob,
  type VisualAssetKind,
} from '@pose-clip/schemas';
import {
  ComfyUiProvider,
  LocalContentAddressedAssetStore,
  PoseClipRawGenerationExecutor,
  type GeneratedImageArtifact,
  type ImageGenerationProvider,
} from '../src/index.js';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

class FixtureProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';
  calls = 0;
  wrongAsset = false;
  bytes = PNG;

  async generate(request: PoseClipFrameJob['generationRequest']): Promise<GeneratedImageArtifact[]> {
    this.calls += 1;
    const contentHash = await sha256Bytes(this.bytes);
    const asset = ProductionVisualAssetRecord({
      id: this.wrongAsset ? `${request.output.assetId}.wrong` : request.output.assetId,
      kind: request.output.kind,
      contentHash,
      inputHash: request.inputHash,
      seed: request.seed,
    });
    return [{
      bytes: this.bytes,
      filePath: `virtual://${contentHash}.png`,
      asset,
      providerMetadata: {fixture: true},
    }];
  }
}

function ProductionVisualAssetRecord(input: {
  id: string;
  kind: VisualAssetKind;
  contentHash: string;
  inputHash: string;
  seed: number;
}) {
  return ProductionVisualAssetSchema.parse({
    id: input.id,
    kind: input.kind,
    uri: contentAddressedAssetUri(input.contentHash),
    contentHash: input.contentHash,
    source: 'generated',
    provenance: {
      inputHash: input.inputHash,
      promptHash: 'a'.repeat(64),
      modelId: 'fixture-diffusion.safetensors',
      seed: input.seed,
      producer: {name: 'comfyui-provider', version: '0.1.2'},
      createdAt: '2026-08-18T00:00:00.000Z',
    },
    qaStatus: 'pending',
    width: 1,
    height: 1,
    alphaMode: 'straight',
  });
}

async function frameJob(frameIndex: number, workflowHash = '1'.repeat(64)): Promise<PoseClipFrameJob> {
  const output = {assetId: `rabbit.run.${frameIndex}`, kind: 'animal-frame' as const};
  const spec = await createPoseClipFrameSpec({
    frameIndex,
    phase: `phase-${frameIndex}`,
    poseIntent: `Rabbit running phase ${frameIndex}`,
    durationFrames: 3,
    contact: 'both',
    referenceFoot: 'midpoint',
    requiredAnchors: ['foot', 'center', 'leftFoot', 'rightFoot'],
    seed: 100 + frameIndex,
    referenceAssets: [],
    output,
  });
  return createPoseClipFrameJob({
    spec,
    generationRequest: await createActionGenerationRequest({
      schemaVersion: '1.0.0',
      actionPackageId: 'rabbit.run',
      entityType: 'rabbit',
      action: 'run',
      direction: 'left',
      frameSpecHash: spec.frameSpecHash,
      workflowId: 'm4-real-four-frame-fixture',
      workflowHash,
      provider: 'comfyui',
      runtimeModels: [
        {role: 'diffusion-model', modelId: 'fixture-diffusion.safetensors', contentHash: '2'.repeat(64)},
        {role: 'text-encoder', modelId: 'fixture-text.safetensors', contentHash: '3'.repeat(64)},
        {role: 'vae', modelId: 'fixture-vae.safetensors', contentHash: '4'.repeat(64)},
      ],
      prompt: `Rabbit running phase ${frameIndex}`,
      seed: spec.seed,
      referenceAssets: [],
      output: {...output, nodeId: '17', expectedCount: 1},
    }),
  });
}

async function request(workflowHash = '1'.repeat(64)): Promise<Awaited<ReturnType<typeof createPoseClipProductionRequest>>> {
  return createPoseClipProductionRequest({
    schemaVersion: '1.0.0',
    id: 'rabbit.run.production',
    actionPackageId: 'rabbit.run',
    poseClipId: 'rabbit.run-left',
    entityType: 'rabbit',
    action: 'run',
    direction: 'left',
    loop: true,
    rootMotion: {mode: 'timeline'},
    groundLock: {mode: 'contact-only', maxCorrectionPx: 24},
    frames: await Promise.all([0, 1, 2, 3].map((index) => frameJob(index, workflowHash))),
  });
}

describe('M4 Commit 1 Raw Four-Frame Generation', () => {
  it('generates four ordered raw frames, writes Raw CAS and reuses Generation Cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm4-raw-generation-'));
    roots.push(root);
    const provider = new FixtureProvider();
    const executor = new PoseClipRawGenerationExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(root),
    });
    const productionRequest = await request();
    const first = await executor.execute(productionRequest);
    expect(first.result.frameResults.map(({frameIndex}) => frameIndex)).toEqual([0, 1, 2, 3]);
    expect(first.result.frameResults.every(({artifact}) => artifact.stage === 'raw')).toBe(true);
    expect(first.frames.map(({cache}) => cache)).toEqual(['miss', 'miss', 'miss', 'miss']);
    expect(provider.calls).toBe(4);
    const firstAsset = first.result.frameResults[0]!.artifact.asset;
    expect(Uint8Array.from(await readFile(join(root, `${firstAsset.contentHash}.png`))).length).toBe(PNG.length);

    const second = await executor.execute(productionRequest);
    expect(second.frames.map(({cache}) => cache)).toEqual(['hit', 'hit', 'hit', 'hit']);
    expect(second.result.resultHash).toBe(first.result.resultHash);
    expect(provider.calls).toBe(4);
  });

  it('fails before CAS publication when provider Asset ID is not bound to FrameSpec', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm4-raw-generation-invalid-'));
    roots.push(root);
    const provider = new FixtureProvider();
    provider.wrongAsset = true;
    const executor = new PoseClipRawGenerationExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(root),
    });
    await expect(executor.execute(await request())).rejects.toMatchObject({code: 'RAW_GENERATION_BINDING_MISMATCH'});
    expect(provider.calls).toBe(1);
  });

  it('rejects truncated PNG bytes before Raw CAS publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm4-raw-generation-truncated-'));
    roots.push(root);
    const provider = new FixtureProvider();
    provider.bytes = PNG.slice(0, 33);
    const executor = new PoseClipRawGenerationExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(root),
    });
    await expect(executor.execute(await request())).rejects.toMatchObject({code: 'RAW_GENERATION_PNG_INVALID'});
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('drives four independent ComfyUI prompt/history/view jobs into Raw CAS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm4-comfyui-four-frame-'));
    roots.push(root);
    const workflow = new TextEncoder().encode(JSON.stringify({
      '17': {class_type: 'SaveImage', inputs: {}},
    }));
    const workflowHash = await sha256Bytes(workflow);
    const promptToHash = new Map<string, string>();
    let promptCalls = 0;
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188',
      outputRoot: root,
      workflowResolver: async () => workflow,
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) {
          promptCalls += 1;
          const body = JSON.parse(String(init?.body)) as {client_id: string};
          const generationInputHash = body.client_id.replace('pose-clip-', '');
          const promptId = `P${promptCalls}`;
          promptToHash.set(promptId, generationInputHash);
          return new Response(JSON.stringify({prompt_id: promptId}));
        }
        const historyMatch = url.pathname.match(/\/history\/(P\d+)$/u);
        if (historyMatch !== null) {
          const promptId = historyMatch[1]!;
          const generationInputHash = promptToHash.get(promptId)!;
          return new Response(JSON.stringify({
            [promptId]: {
              prompt: [0, promptId, {}, {
                client_id: `pose-clip-${generationInputHash}`,
                generationRequestHash: generationInputHash,
              }],
              status: {status_str: 'success'},
              outputs: {'17': {images: [{filename: `${promptId}.png`, subfolder: '', type: 'output'}]}},
            },
          }));
        }
        if (url.pathname.endsWith('/view')) return new Response(PNG, {headers: {'content-type': 'image/png'}});
        return new Response('not found', {status: 404});
      },
      pollIntervalMs: 0,
      timeoutMs: 100,
    });
    const execution = await new PoseClipRawGenerationExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(root),
    }).execute(await request(workflowHash));
    expect(promptCalls).toBe(4);
    expect(execution.result.frameResults.map(({frameIndex}) => frameIndex)).toEqual([0, 1, 2, 3]);
    expect(new Set(execution.result.frameResults.map(({artifact}) => artifact.asset.uri)).size).toBe(1);
  });
});
