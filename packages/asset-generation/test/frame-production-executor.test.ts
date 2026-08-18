import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  ProductionVisualAssetSchema,
  contentAddressedAssetUri,
  createActionGenerationRequest,
  createPoseClipFrameJob,
  createPoseClipFrameSpec,
  createPoseFrameProcessorSpec,
  createPoseFrameQaEvaluatorSpec,
  sha256Bytes,
  type PoseAnchors,
  type PoseClipFrameJob,
  type PoseFrameProcessorSpec,
} from '@pose-clip/schemas';
import {
  AssetGenerationTransientError,
  ComfyUiProvider,
  DeterministicReferencePoseFrameProcessor,
  InMemoryPoseFrameGenerationCache,
  InMemoryPoseFrameGenerationResumeCache,
  InMemoryPoseFrameResultCache,
  InMemoryPoseFrameStageCache,
  LocalContentAddressedAssetStore,
  PoseFrameProductionExecutor,
  PoseFrameProcessorTransientError,
  RequiredAnchorPoseFrameQaEvaluator,
  type GeneratedImageArtifact,
  type ImageGenerationProvider,
  type PoseFramePipelineStage,
  type PoseFrameQaBinding,
  type PoseFrameProcessor,
  type PoseFrameProcessorInput,
  type PoseFrameProcessorOutput,
} from '../src/index.js';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1WzWQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);
const ANCHORS: PoseAnchors = {
  foot: {x: 0.5, y: 0.94},
  leftFoot: {x: 0.43, y: 0.94},
  rightFoot: {x: 0.57, y: 0.94},
  center: {x: 0.5, y: 0.5},
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

function append(bytes: Uint8Array, text: string): Uint8Array {
  const suffix = new TextEncoder().encode(text);
  const output = new Uint8Array(bytes.length + suffix.length);
  output.set(bytes);
  output.set(suffix, bytes.length);
  return output;
}

function completedHistory(promptId: string, generationInputHash: string): Record<string, unknown> {
  return {
    [promptId]: {
      prompt: [0, promptId, {}, {
        client_id: `pose-clip-${generationInputHash}`,
        generationRequestHash: generationInputHash,
      }],
      status: {status_str: 'success'},
      outputs: {'17': {images: [{filename: 'rabbit.png', subfolder: '', type: 'output'}]}},
    },
  };
}

class CountingComfyProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';
  calls = 0;

  constructor(private failuresRemaining = 0) {}

  async generate(request: PoseClipFrameJob['generationRequest']): Promise<GeneratedImageArtifact[]> {
    this.calls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new AssetGenerationTransientError('TEST_TRANSIENT', 'transient ComfyUI failure');
    }
    const bytes = append(PNG, `\nraw:${request.inputHash}`);
    const contentHash = await sha256Bytes(bytes);
    const asset = ProductionVisualAssetSchema.parse({
      id: request.output.assetId,
      kind: request.output.kind,
      uri: contentAddressedAssetUri(contentHash),
      contentHash,
      source: 'generated',
      provenance: {
        inputHash: request.inputHash,
        promptHash: 'a'.repeat(64),
        modelId: request.runtimeModels[0]!.modelId,
        seed: request.seed,
        producer: {name: 'comfyui-provider', version: '0.1.2'},
        createdAt: `2026-08-15T12:00:${String(this.calls).padStart(2, '0')}.000Z`,
      },
      qaStatus: 'pending',
      width: 1,
      height: 1,
      alphaMode: 'straight',
    });
    return [{bytes, filePath: `virtual://${contentHash}.png`, asset, providerMetadata: {call: this.calls}}];
  }
}

class FailingOnceProcessor implements PoseFrameProcessor {
  calls = 0;

  constructor(
    private readonly inner: PoseFrameProcessor,
    private failuresRemaining = 1,
  ) {}

  get id(): string { return this.inner.id; }
  get version(): string { return this.inner.version; }
  get stage() { return this.inner.stage; }

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    this.calls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new PoseFrameProcessorTransientError('transient processor failure');
    }
    return this.inner.process(input);
  }
}

class MutatingFailingOnceProcessor implements PoseFrameProcessor {
  readonly observedFirstBytes: number[] = [];

  constructor(private readonly inner: PoseFrameProcessor) {}

  get id(): string { return this.inner.id; }
  get version(): string { return this.inner.version; }
  get stage() { return this.inner.stage; }

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    this.observedFirstBytes.push(input.bytes[0]!);
    if (this.observedFirstBytes.length === 1) {
      input.bytes[0] = 0;
      throw new PoseFrameProcessorTransientError('mutated transient processor failure');
    }
    return this.inner.process(input);
  }
}

async function frameJob(
  frameIndex = 0,
  poseIntent?: string,
  referenceAssets: Array<{assetId: string; contentHash: string}> = [],
): Promise<PoseClipFrameJob> {
  const output = {assetId: `rabbit.run-left.${frameIndex + 1}`, kind: 'animal-frame' as const};
  const spec = await createPoseClipFrameSpec({
    frameIndex,
    phase: frameIndex % 2 === 0 ? 'contact' : 'passing',
    poseIntent: poseIntent ?? `Rabbit run phase ${frameIndex + 1}`,
    durationFrames: 3,
    contact: 'both',
    referenceFoot: 'midpoint',
    requiredAnchors: ['foot', 'center', 'leftFoot', 'rightFoot'],
    seed: 4200 + frameIndex,
    referenceAssets,
    output,
  });
  const generationRequest = await createActionGenerationRequest({
    schemaVersion: '1.0.0',
    actionPackageId: 'rabbit.run',
    entityType: 'rabbit',
    action: 'run',
    direction: 'left',
    frameSpecHash: spec.frameSpecHash,
    workflowId: 'flux2-klein-single-frame-v1',
    workflowHash: '1'.repeat(64),
    provider: 'comfyui',
    runtimeModels: [
      {role: 'diffusion-model', modelId: 'flux-2.safetensors', contentHash: '2'.repeat(64)},
      {role: 'text-encoder', modelId: 'qwen.safetensors', contentHash: '3'.repeat(64)},
      {role: 'vae', modelId: 'flux2-vae.safetensors', contentHash: '4'.repeat(64)},
    ],
    prompt: `Whole-body rabbit run phase ${frameIndex + 1}`,
    negativePrompt: 'cropped feet, extra limbs',
    seed: spec.seed,
    referenceAssets,
    output: {...output, nodeId: '17', expectedCount: 1},
  });
  return createPoseClipFrameJob({spec, generationRequest});
}

async function withWorkflowHash(job: PoseClipFrameJob, workflowHash: string): Promise<PoseClipFrameJob> {
  const {inputHash: _inputHash, ...payload} = job.generationRequest;
  const generationRequest = await createActionGenerationRequest({...payload, workflowHash});
  return createPoseClipFrameJob({spec: job.spec, generationRequest});
}

interface PipelineConfig {
  mattingThreshold?: number;
  anchorMethod?: string;
  anchors?: PoseAnchors;
  mattingProcessor?: PoseFrameProcessor;
}

async function pipeline(config: PipelineConfig = {}): Promise<readonly PoseFramePipelineStage[]> {
  const definitions = [
    {
      stage: 'matted' as const,
      processor: {name: 'fake-matting', version: '1.0.0'},
      model: {modelId: 'rmbg-2.0', contentHash: '5'.repeat(64)},
      config: {threshold: config.mattingThreshold ?? 0.5},
    },
    {
      stage: 'normalized' as const,
      processor: {name: 'fake-normalize', version: '1.0.0'},
      config: {canvas: {width: 768, height: 1024}, padding: 32},
    },
    {
      stage: 'anchored' as const,
      processor: {name: 'fake-anchor', version: '1.0.0'},
      config: {method: config.anchorMethod ?? 'reference-v1', anchors: config.anchors ?? ANCHORS},
    },
  ];
  const specs: PoseFrameProcessorSpec[] = [];
  for (const definition of definitions) specs.push(await createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    ...definition,
  }));
  return specs.map((spec) => ({
    spec,
    processor: spec.stage === 'matted' && config.mattingProcessor !== undefined
      ? config.mattingProcessor
      : new DeterministicReferencePoseFrameProcessor(
        spec.stage,
        spec.processor.name,
        spec.processor.version,
      ),
  }));
}

async function qaBinding(anchorTolerance: number): Promise<PoseFrameQaBinding> {
  return {
    spec: await createPoseFrameQaEvaluatorSpec({
      schemaVersion: '1.0.0',
      evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
      config: {anchorTolerance},
    }),
    evaluator: new RequiredAnchorPoseFrameQaEvaluator(),
  };
}

async function testRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pose-frame-pipeline-'));
  roots.push(root);
  return root;
}

describe('M3 Frame Production Pipeline', () => {
  it('connects a FrameJob through the real ComfyUiProvider adapter into the four-stage pipeline', async () => {
    const workflow = new TextEncoder().encode(JSON.stringify({
      '17': {class_type: 'SaveImage', inputs: {}},
    }));
    const baseJob = await frameJob();
    const {inputHash: _inputHash, ...generationPayload} = baseJob.generationRequest;
    const generationRequest = await createActionGenerationRequest({
      ...generationPayload,
      workflowHash: await sha256Bytes(workflow),
    });
    const job = await createPoseClipFrameJob({spec: baseJob.spec, generationRequest});
    const root = await testRoot();
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188',
      outputRoot: root,
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) return new Response(JSON.stringify({prompt_id: 'frame-prompt'}));
        if (url.pathname.endsWith('/history/frame-prompt')) {
          return new Response(JSON.stringify(completedHistory('frame-prompt', generationRequest.inputHash)));
        }
        if (url.pathname.endsWith('/view')) return new Response(PNG);
        return new Response('not found', {status: 404});
      },
      now: () => new Date('2026-08-15T12:00:00.000Z'),
      pollIntervalMs: 0,
      timeoutMs: 100,
    });
    const execution = await new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(root),
      stages: await pipeline(),
    }).execute(job);
    expect(execution.result.qa.productionReady).toBe(true);
    expect(execution.result.artifacts.map(({stage}) => stage)).toEqual(['raw', 'matted', 'normalized', 'anchored']);
    expect(execution.result.artifacts[0]!.asset.provenance?.inputHash).toBe(generationRequest.inputHash);
  });

  it('runs Generate → Matting → Normalize → Anchor and reuses the complete Frame Result', async () => {
    const provider = new CountingComfyProvider();
    const executor = new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
    });
    const job = await frameJob();
    const first = await executor.execute(job);
    expect(first.resultCache).toBe('miss');
    expect(first.generation).toMatchObject({cache: 'miss', attempts: 1});
    expect(first.stages.map(({cache, attempts}) => ({cache, attempts}))).toEqual([
      {cache: 'miss', attempts: 1},
      {cache: 'miss', attempts: 1},
      {cache: 'miss', attempts: 1},
    ]);
    expect(first.result.artifacts.map(({stage}) => stage)).toEqual(['raw', 'matted', 'normalized', 'anchored']);
    expect(first.result.artifacts[0]!.asset).toMatchObject({
      source: 'generated',
      provenance: {inputHash: job.generationRequest.inputHash},
    });
    expect(first.result.qa.productionReady).toBe(true);

    const second = await executor.execute(job);
    expect(second.resultCache).toBe('hit');
    expect(second.result).toEqual(first.result);
    expect(provider.calls).toBe(1);
  });

  it('invalidates downstream stages from the first changed ProcessorSpec only', async () => {
    const provider = new CountingComfyProvider();
    const generationCache = new InMemoryPoseFrameGenerationCache();
    const stageCache = new InMemoryPoseFrameStageCache();
    const resultCache = new InMemoryPoseFrameResultCache();
    const cas = new LocalContentAddressedAssetStore(await testRoot());
    const job = await frameJob();
    await new PoseFrameProductionExecutor({
      provider, cas, generationCache, stageCache, resultCache, stages: await pipeline(),
    }).execute(job);

    const changedMatting = await new PoseFrameProductionExecutor({
      provider, cas, generationCache, stageCache, resultCache,
      stages: await pipeline({mattingThreshold: 0.7}),
    }).execute(job);
    expect(changedMatting.resultCache).toBe('miss');
    expect(changedMatting.generation.cache).toBe('hit');
    expect(changedMatting.stages.map(({cache}) => cache)).toEqual(['miss', 'miss', 'miss']);

    const changedAnchor = await new PoseFrameProductionExecutor({
      provider, cas, generationCache, stageCache, resultCache,
      stages: await pipeline({anchorMethod: 'reference-v2'}),
    }).execute(job);
    expect(changedAnchor.resultCache).toBe('miss');
    expect(changedAnchor.generation.cache).toBe('hit');
    expect(changedAnchor.stages.map(({cache}) => cache)).toEqual(['hit', 'hit', 'miss']);

    const movedAnchors = structuredClone(ANCHORS);
    movedAnchors.foot.y = 0.8;
    const changedAnchorData = await new PoseFrameProductionExecutor({
      provider, cas, generationCache, stageCache, resultCache,
      stages: await pipeline({anchors: movedAnchors}),
    }).execute(job);
    expect(changedAnchorData.resultCache).toBe('miss');
    expect(changedAnchorData.generation.cache).toBe('hit');
    expect(changedAnchorData.stages.map(({cache}) => cache)).toEqual(['hit', 'hit', 'miss']);
    expect(changedAnchorData.result.poseFrame.anchors.foot.y).toBe(0.8);
  });

  it('invalidates Frame Result cache when QA configuration changes without rerunning image stages', async () => {
    const provider = new CountingComfyProvider();
    const generationCache = new InMemoryPoseFrameGenerationCache();
    const stageCache = new InMemoryPoseFrameStageCache();
    const resultCache = new InMemoryPoseFrameResultCache();
    const cas = new LocalContentAddressedAssetStore(await testRoot());
    const stages = await pipeline();
    const job = await frameJob();
    const first = await new PoseFrameProductionExecutor({
      provider, cas, stages, generationCache, stageCache, resultCache,
      qa: await qaBinding(0.05),
    }).execute(job);
    const changed = await new PoseFrameProductionExecutor({
      provider, cas, stages, generationCache, stageCache, resultCache,
      qa: await qaBinding(0.1),
    }).execute(job);
    expect(changed.frameExecutionKey).not.toBe(first.frameExecutionKey);
    expect(changed.result.frameExecutionKey).toBe(changed.frameExecutionKey);
    expect(changed.result.qa).toEqual(first.result.qa);
    expect(changed.result.resultHash).not.toBe(first.result.resultHash);
    expect(changed.resultCache).toBe('miss');
    expect(changed.generation.cache).toBe('hit');
    expect(changed.stages.map(({cache}) => cache)).toEqual(['hit', 'hit', 'hit']);
  });

  it('keys stage caches by upstream bytes and ProcessorSpec rather than evidence timestamps', async () => {
    const provider = new CountingComfyProvider();
    const stageCache = new InMemoryPoseFrameStageCache();
    const cas = new LocalContentAddressedAssetStore(await testRoot());
    const stages = await pipeline();
    const job = await frameJob();
    const first = await new PoseFrameProductionExecutor({
      provider, cas, stages, stageCache,
      generationCache: new InMemoryPoseFrameGenerationCache(),
      resultCache: new InMemoryPoseFrameResultCache(),
    }).execute(job);
    const second = await new PoseFrameProductionExecutor({
      provider, cas, stages, stageCache,
      generationCache: new InMemoryPoseFrameGenerationCache(),
      resultCache: new InMemoryPoseFrameResultCache(),
    }).execute(job);
    expect(first.generation.cache).toBe('miss');
    expect(second.generation.cache).toBe('miss');
    expect(second.stages.map(({cache}) => cache)).toEqual(['hit', 'hit', 'hit']);
    expect(first.result.artifacts[0]!.asset.provenance?.createdAt)
      .not.toBe(second.result.artifacts[0]!.asset.provenance?.createdAt);
    expect(first.result.artifacts[0]!.asset.contentHash)
      .toBe(second.result.artifacts[0]!.asset.contentHash);
  });

  it('retries transient provider and processor failures without widening the cache key', async () => {
    const provider = new CountingComfyProvider(1);
    const baseMatting = new DeterministicReferencePoseFrameProcessor('matted', 'fake-matting', '1.0.0');
    const flakyMatting = new FailingOnceProcessor(baseMatting);
    const execution = await new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline({mattingProcessor: flakyMatting}),
      maxAttempts: 2,
    }).execute(await frameJob());
    expect(execution.generation).toMatchObject({cache: 'miss', attempts: 2});
    expect(execution.stages[0]).toMatchObject({cache: 'miss', attempts: 2});
    expect(provider.calls).toBe(2);
    expect(flakyMatting.calls).toBe(2);
  });

  it('gives every Processor attempt a fresh copy of the original input bytes', async () => {
    const processor = new MutatingFailingOnceProcessor(
      new DeterministicReferencePoseFrameProcessor('matted', 'fake-matting', '1.0.0'),
    );
    const execution = await new PoseFrameProductionExecutor({
      provider: new CountingComfyProvider(),
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline({mattingProcessor: processor}),
      maxAttempts: 2,
    }).execute(await frameJob());
    expect(processor.observedFirstBytes).toEqual([PNG[0], PNG[0]]);
    expect(execution.stages[0]).toMatchObject({cache: 'miss', attempts: 2});
  });

  it('retries History for the submitted prompt without queueing a second ComfyUI job', async () => {
    const workflow = new TextEncoder().encode(JSON.stringify({'17': {class_type: 'SaveImage', inputs: {}}}));
    const workflowHash = await sha256Bytes(workflow);
    let promptCalls = 0;
    let historyCalls = 0;
    const job = await withWorkflowHash(await frameJob(), workflowHash);
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot: await testRoot(),
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) {
          promptCalls += 1;
          return new Response(JSON.stringify({prompt_id: 'P1'}));
        }
        if (url.pathname.endsWith('/history/P1')) {
          historyCalls += 1;
          if (historyCalls === 1) return new Response('temporarily unavailable', {status: 503});
          return new Response(JSON.stringify(completedHistory('P1', job.generationRequest.inputHash)));
        }
        if (url.pathname.endsWith('/view')) return new Response(PNG);
        return new Response('not found', {status: 404});
      },
      pollIntervalMs: 0, timeoutMs: 100,
    });
    const execution = await new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(), maxAttempts: 2,
    }).execute(job);
    expect(promptCalls).toBe(1);
    expect(historyCalls).toBe(2);
    expect(execution.generation.attempts).toBe(2);
  });

  it('fails closed when /prompt transport state is ambiguous without queueing a second job', async () => {
    const workflow = new TextEncoder().encode(JSON.stringify({'17': {class_type: 'SaveImage', inputs: {}}}));
    const workflowHash = await sha256Bytes(workflow);
    let promptCalls = 0;
    const job = await withWorkflowHash(await frameJob(), workflowHash);
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot: await testRoot(),
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) {
          promptCalls += 1;
          if (promptCalls === 1) throw new Error('response lost after server accepted request');
          return new Response(JSON.stringify({prompt_id: 'P2'}));
        }
        return new Response('not found', {status: 404});
      },
    });
    await expect(new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
      maxAttempts: 2,
    }).execute(job)).rejects.toMatchObject({code: 'GENERATION_UNKNOWN_SUBMISSION_STATE'});
    expect(promptCalls).toBe(1);
  });

  it('retries output download for the same completed prompt without regenerating it', async () => {
    const workflow = new TextEncoder().encode(JSON.stringify({'17': {class_type: 'SaveImage', inputs: {}}}));
    const workflowHash = await sha256Bytes(workflow);
    let promptCalls = 0;
    let viewCalls = 0;
    const job = await withWorkflowHash(await frameJob(), workflowHash);
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot: await testRoot(),
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) {
          promptCalls += 1;
          return new Response(JSON.stringify({prompt_id: 'P1'}));
        }
        if (url.pathname.endsWith('/history/P1')) {
          return new Response(JSON.stringify(completedHistory('P1', job.generationRequest.inputHash)));
        }
        if (url.pathname.endsWith('/view')) {
          viewCalls += 1;
          return viewCalls === 1
            ? new Response('temporarily unavailable', {status: 503})
            : new Response(PNG);
        }
        return new Response('not found', {status: 404});
      },
      pollIntervalMs: 0, timeoutMs: 100,
    });
    await new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(), maxAttempts: 2,
    }).execute(job);
    expect(promptCalls).toBe(1);
    expect(viewCalls).toBe(2);
  });

  it('keeps a submitted prompt in the resume cache after collection is interrupted', async () => {
    const workflow = new TextEncoder().encode(JSON.stringify({'17': {class_type: 'SaveImage', inputs: {}}}));
    const workflowHash = await sha256Bytes(workflow);
    const resumeCache = new InMemoryPoseFrameGenerationResumeCache();
    let promptCalls = 0;
    let historyCalls = 0;
    const job = await withWorkflowHash(await frameJob(), workflowHash);
    const provider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188', outputRoot: await testRoot(),
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) {
          promptCalls += 1;
          return new Response(JSON.stringify({prompt_id: 'P1'}));
        }
        if (url.pathname.endsWith('/history/P1')) {
          historyCalls += 1;
          if (historyCalls === 1) return new Response('temporarily unavailable', {status: 503});
          return new Response(JSON.stringify(completedHistory('P1', job.generationRequest.inputHash)));
        }
        if (url.pathname.endsWith('/view')) return new Response(PNG);
        return new Response('not found', {status: 404});
      },
      pollIntervalMs: 0, timeoutMs: 100,
    });
    const options = {
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
      generationResumeCache: resumeCache,
      maxAttempts: 1,
    };
    await expect(new PoseFrameProductionExecutor(options).execute(job)).rejects.toMatchObject({
      code: 'FRAME_PRODUCTION_RETRY_EXHAUSTED',
    });
    await expect(new PoseFrameProductionExecutor(options).execute(job)).resolves.toBeDefined();
    expect(promptCalls).toBe(1);
    expect(historyCalls).toBe(2);
  });

  it('rejects a resumed prompt whose server-side binding belongs to another request', async () => {
    const job = await frameJob();
    for (const promptMetadata of [
      {
        client_id: 'pose-clip-another-request',
        generationRequestHash: job.generationRequest.inputHash,
      },
      {
        client_id: `pose-clip-${job.generationRequest.inputHash}`,
        generationRequestHash: 'f'.repeat(64),
      },
    ]) {
      const resumeCache = new InMemoryPoseFrameGenerationResumeCache();
      await resumeCache.set(job.generationRequest.inputHash, {
        generationInputHash: job.generationRequest.inputHash,
        promptId: 'P1',
      });
      let promptCalls = 0;
      let historyCalls = 0;
      let viewCalls = 0;
      const provider = new ComfyUiProvider({
        endpoint: 'http://127.0.0.1:8188', outputRoot: await testRoot(),
        workflowResolver: async () => { throw new Error('resume must not resolve a workflow'); },
        fetch: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
          if (url.pathname.endsWith('/prompt')) {
            promptCalls += 1;
            return new Response(JSON.stringify({prompt_id: 'P2'}));
          }
          if (url.pathname.endsWith('/history/P1')) {
            historyCalls += 1;
            return new Response(JSON.stringify({P1: {
              prompt: [0, 'P1', {}, promptMetadata],
              status: {status_str: 'success'},
              outputs: {'17': {images: [{filename: 'wrong.png', subfolder: '', type: 'output'}]}},
            }}));
          }
          if (url.pathname.endsWith('/view')) {
            viewCalls += 1;
            return new Response(PNG);
          }
          return new Response('not found', {status: 404});
        },
        pollIntervalMs: 0, timeoutMs: 100,
      });
      await expect(new PoseFrameProductionExecutor({
        provider,
        cas: new LocalContentAddressedAssetStore(await testRoot()),
        stages: await pipeline(),
        generationResumeCache: resumeCache,
        maxAttempts: 3,
      }).execute(job)).rejects.toMatchObject({
        code: 'GENERATION_PROMPT_BINDING_MISMATCH',
      });
      expect(promptCalls).toBe(0);
      expect(historyCalls).toBe(1);
      expect(viewCalls).toBe(0);
    }
  });

  it('fails fast for ComfyUI integrity errors and retries an explicit HTTP 503', async () => {
    const workflow = new TextEncoder().encode(JSON.stringify({'17': {class_type: 'SaveImage', inputs: {}}}));
    const workflowHash = await sha256Bytes(workflow);

    let workflowReads = 0;
    const workflowMismatchProvider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188',
      outputRoot: await testRoot(),
      workflowResolver: async () => { workflowReads += 1; return workflow; },
      fetch: async () => new Response('should not be called', {status: 500}),
    });
    await expect(new PoseFrameProductionExecutor({
      provider: workflowMismatchProvider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
      maxAttempts: 3,
    }).execute(await frameJob())).rejects.toMatchObject({
      code: 'GENERATION_WORKFLOW_HASH_MISMATCH',
    });
    expect(workflowReads).toBe(1);

    let referenceReads = 0;
    const referenceMismatchProvider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188',
      outputRoot: await testRoot(),
      workflowResolver: async () => workflow,
      referenceResolver: async () => { referenceReads += 1; return {bytes: PNG}; },
      fetch: async () => new Response('should not be called', {status: 500}),
    });
    const referenceJob = await withWorkflowHash(
      await frameJob(0, undefined, [{assetId: 'rabbit.reference', contentHash: 'e'.repeat(64)}]),
      workflowHash,
    );
    await expect(new PoseFrameProductionExecutor({
      provider: referenceMismatchProvider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
      maxAttempts: 3,
    }).execute(referenceJob)).rejects.toMatchObject({
      code: 'GENERATION_REFERENCE_HASH_MISMATCH',
    });
    expect(referenceReads).toBe(1);

    let promptCalls = 0;
    const transientJob = await withWorkflowHash(await frameJob(), workflowHash);
    const transientProvider = new ComfyUiProvider({
      endpoint: 'http://127.0.0.1:8188',
      outputRoot: await testRoot(),
      workflowResolver: async () => workflow,
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname.endsWith('/prompt')) {
          promptCalls += 1;
          return promptCalls === 1
            ? new Response('temporarily unavailable', {status: 503})
            : new Response(JSON.stringify({prompt_id: 'retry-prompt'}));
        }
        if (url.pathname.endsWith('/history/retry-prompt')) {
          return new Response(JSON.stringify(completedHistory(
            'retry-prompt',
            transientJob.generationRequest.inputHash,
          )));
        }
        if (url.pathname.endsWith('/view')) return new Response(PNG);
        return new Response('not found', {status: 404});
      },
      now: () => new Date('2026-08-15T12:00:00.000Z'),
      pollIntervalMs: 0,
      timeoutMs: 100,
    });
    const execution = await new PoseFrameProductionExecutor({
      provider: transientProvider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
      maxAttempts: 2,
    }).execute(transientJob);
    expect(execution.generation).toMatchObject({cache: 'miss', attempts: 2});
    expect(promptCalls).toBe(2);
  });

  it('fails without retry when Raw Asset provenance is not bound to the Generation Request', async () => {
    const source = new CountingComfyProvider();
    const provider: ImageGenerationProvider = {
      id: 'comfyui',
      async generate(request) {
        const [artifact] = await source.generate(request);
        return [{
          ...artifact!,
          asset: {
            ...artifact!.asset,
            provenance: {...artifact!.asset.provenance!, inputHash: 'f'.repeat(64)},
          },
        }];
      },
    };
    await expect(new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(),
      maxAttempts: 3,
    }).execute(await frameJob())).rejects.toMatchObject({
      code: 'RAW_GENERATION_BINDING_MISMATCH',
    });
    expect(source.calls).toBe(1);
  });

  it('invalidates only the changed frame across a four-frame production run', async () => {
    const provider = new CountingComfyProvider();
    const generationCache = new InMemoryPoseFrameGenerationCache();
    const stageCache = new InMemoryPoseFrameStageCache();
    const resultCache = new InMemoryPoseFrameResultCache();
    const executor = new PoseFrameProductionExecutor({
      provider,
      cas: new LocalContentAddressedAssetStore(await testRoot()),
      stages: await pipeline(), generationCache, stageCache, resultCache,
    });
    const jobs = await Promise.all([0, 1, 2, 3].map((index) => frameJob(index)));
    await Promise.all(jobs.map((job) => executor.execute(job)));
    const changedFrameTwo = await frameJob(2, 'Rabbit extends the right leg at contact');
    const rerun = await Promise.all(jobs.map((job, index) => executor.execute(index === 2 ? changedFrameTwo : job)));
    expect(rerun.map(({resultCache}) => resultCache)).toEqual(['hit', 'hit', 'miss', 'hit']);
    expect(rerun[2]!.generation.cache).toBe('miss');
    expect(rerun[2]!.stages.map(({cache}) => cache)).toEqual(['miss', 'miss', 'miss']);
    expect(provider.calls).toBe(5);
  });
});
