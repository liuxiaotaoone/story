import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  ProductionVisualAssetSchema,
  assertPoseClipMattingResultIntegrity,
  contentAddressedAssetUri,
  createActionGenerationRequest,
  createPoseClipFrameJob,
  createPoseClipFrameSpec,
  createPoseClipProductionRequest,
  createPoseFrameProcessorSpec,
  hashPoseClipMattedFrameResultPayload,
  hashPoseClipMattingResultPayload,
  hashPoseFrameArtifactPayload,
  sha256Bytes,
  type PoseClipFrameJob,
} from '@pose-clip/schemas';
import {
  CanonicalCanvasPoseFrameNormalizer,
  ChromaKeyPoseFrameMattingProcessor,
  InMemoryPoseFrameStageCache,
  LocalCasAssetByteResolver,
  LocalContentAddressedAssetStore,
  PoseClipMattingExecutor,
  PoseClipNormalizationExecutor,
  PoseClipRawGenerationExecutor,
  decodePngToRgba8,
  decodeRgbaPng8,
  encodeRgbaPng,
  inspectPng,
  rgbaAlphaRange,
  type GeneratedImageArtifact,
  type ImageGenerationProvider,
  type PoseFrameProcessor,
  type PoseFrameProcessorInput,
  type PoseFrameProcessorOutput,
  type PoseFrameNormalizer,
} from '../src/index.js';

const roots: string[] = [];
const RGB_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNg+M/wn4EBAAf/Af+L7e0BAAAAAElFTkSuQmCC'),
  (character) => character.charCodeAt(0),
);
const RGB_TRNS_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAABnRSTlMA/wAAAACkwsAdAAAAD0lEQVR4nGNg+M/wn4EBAAf/Af+L7e0BAAAAAElFTkSuQmCC'),
  (character) => character.charCodeAt(0),
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

function rawPng(frameIndex: number): Uint8Array {
  return encodeRgbaPng({
    width: 2,
    height: 1,
    pixels: Uint8Array.from([
      0, 255, 0, 255,
      255 - frameIndex * 10, frameIndex * 5, 0, 255,
    ]),
  });
}

class RawFixtureProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';
  calls = 0;

  async generate(request: PoseClipFrameJob['generationRequest']): Promise<GeneratedImageArtifact[]> {
    this.calls += 1;
    const frameIndex = request.seed - 100;
    const bytes = rawPng(frameIndex);
    const contentHash = await sha256Bytes(bytes);
    return [{
      bytes,
      filePath: `virtual://${contentHash}.png`,
      asset: ProductionVisualAssetSchema.parse({
        id: request.output.assetId,
        kind: request.output.kind,
        uri: contentAddressedAssetUri(contentHash),
        contentHash,
        source: 'generated',
        provenance: {
          inputHash: request.inputHash,
          promptHash: 'a'.repeat(64),
          modelId: 'fixture-diffusion.safetensors',
          seed: request.seed,
          producer: {name: 'comfyui-provider', version: '0.1.2'},
          createdAt: '2026-08-22T00:00:00.000Z',
        },
        qaStatus: 'pending',
        width: 2,
        height: 1,
        alphaMode: 'straight',
      }),
      providerMetadata: {fixture: true},
    }];
  }
}

async function frameJob(frameIndex: number): Promise<PoseClipFrameJob> {
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
      workflowId: 'm4-real-matting-fixture',
      workflowHash: '1'.repeat(64),
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

async function request() {
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
    frames: await Promise.all(Array.from({length: 4}, (_, index) => frameJob(index))),
  });
}

async function mattingSpec(
  transparentThreshold = 0.05,
  model?: {readonly modelId: string; readonly contentHash: string},
) {
  return createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'matted',
    processor: {name: 'chroma-key-matting', version: '1.0.0'},
    ...(model === undefined ? {} : {model}),
    config: {
      keyColor: [0, 255, 0],
      transparentThreshold,
      opaqueThreshold: 0.2,
      spillSuppression: 0.75,
    },
  });
}

async function fixture() {
  const rawRoot = await mkdtemp(join(tmpdir(), 'm4-matting-raw-'));
  const mattedRoot = await mkdtemp(join(tmpdir(), 'm4-matting-output-'));
  roots.push(rawRoot, mattedRoot);
  const productionRequest = await request();
  const provider = new RawFixtureProvider();
  const rawExecution = await new PoseClipRawGenerationExecutor({
    provider,
    cas: new LocalContentAddressedAssetStore(rawRoot),
  }).execute(productionRequest);
  return {rawRoot, mattedRoot, productionRequest, provider, rawExecution};
}

async function normalizationSpec(targetForegroundHeight = 4) {
  return createPoseFrameProcessorSpec({
    schemaVersion: '1.0.0',
    stage: 'normalized',
    processor: {name: 'canonical-canvas-normalize', version: '1.0.0'},
    config: {
      canvasWidth: 8,
      canvasHeight: 8,
      targetForegroundHeight,
      maxForegroundWidth: 6,
      bottomPadding: 1,
      alphaThreshold: 1,
      resampling: 'bilinear-premultiplied',
    },
  });
}

async function normalizedFixture() {
  const value = await fixture();
  const normalizedRoot = await mkdtemp(join(tmpdir(), 'm4-normalization-output-'));
  roots.push(normalizedRoot);
  const activeMattingSpec = await mattingSpec();
  const mattingExecution = await new PoseClipMattingExecutor({
    resolver: new LocalCasAssetByteResolver(value.rawRoot),
    cas: new LocalContentAddressedAssetStore(value.mattedRoot),
    spec: activeMattingSpec,
    processor: new ChromaKeyPoseFrameMattingProcessor(),
  }).execute(value.productionRequest, value.rawExecution.result);
  return {...value, normalizedRoot, activeMattingSpec, mattingExecution};
}

describe('M4 Commit 2.1 Matting Integrity Closure', () => {
  it('decodes opaque RGB and fails closed for RGB+tRNS instead of losing transparency', () => {
    expect(inspectPng(RGB_PNG).alphaMode).toBe('opaque');
    expect(Array.from(decodePngToRgba8(RGB_PNG).pixels)).toEqual([
      0, 255, 0, 255,
      255, 0, 0, 255,
    ]);
    expect(inspectPng(RGB_TRNS_PNG).alphaMode).toBe('straight');
    expect(() => decodePngToRgba8(RGB_TRNS_PNG)).toThrow(
      'Matting does not support RGB PNG with tRNS transparency',
    );
  });

  it('creates four ordered RGBA Matted artifacts with an immutable Raw evidence chain', async () => {
    const value = await fixture();
    const rawSnapshot = structuredClone(value.rawExecution.result);
    const stageCache = new InMemoryPoseFrameStageCache();
    const executor = new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: await mattingSpec(),
      processor: new ChromaKeyPoseFrameMattingProcessor(),
      stageCache,
      now: () => new Date('2026-08-22T01:00:00.000Z'),
    });
    const first = await executor.execute(value.productionRequest, value.rawExecution.result);
    expect(first.result.frameResults.map(({frameIndex}) => frameIndex)).toEqual([0, 1, 2, 3]);
    expect(first.frames.map(({cache}) => cache).filter((status) => status === 'miss')).toHaveLength(4);
    expect(first.result.rawGenerationResultHash).toBe(value.rawExecution.result.resultHash);
    expect(value.rawExecution.result).toEqual(rawSnapshot);
    for (const frame of first.result.frameResults) {
      expect(frame.artifact.stage).toBe('matted');
      expect(frame.artifact.inputHash).toBe(rawSnapshot.frameResults[frame.frameIndex]!.artifact.outputHash);
      expect(frame.artifact.asset.provenance?.modelId).toBeUndefined();
      const bytes = new Uint8Array(await readFile(join(value.mattedRoot, `${frame.artifact.asset.contentHash}.png`)));
      const alpha = rgbaAlphaRange(decodeRgbaPng8(bytes).pixels);
      expect(alpha.min).toBe(0);
      expect(alpha.max).toBe(255);
    }

    const second = await executor.execute(value.productionRequest, value.rawExecution.result);
    expect(second.frames.map(({cache}) => cache)).toEqual(['hit', 'hit', 'hit', 'hit']);
    expect(second.result.resultHash).toBe(first.result.resultHash);
    expect(value.provider.calls).toBe(4);
  });

  it('binds algorithm config without inventing a model identity', async () => {
    const value = await fixture();
    const cache = new InMemoryPoseFrameStageCache();
    const base = await new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: await mattingSpec(0.05),
      processor: new ChromaKeyPoseFrameMattingProcessor(),
      stageCache: cache,
    }).execute(value.productionRequest, value.rawExecution.result);
    const changed = await new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: await mattingSpec(0.08),
      processor: new ChromaKeyPoseFrameMattingProcessor(),
      stageCache: cache,
    }).execute(value.productionRequest, value.rawExecution.result);
    expect(changed.frames.every(({cache: status}) => status === 'miss')).toBe(true);
    expect(changed.result.processorSpecHash).not.toBe(base.result.processorSpecHash);
    expect(changed.frames.map(({mattingInputHash}) => mattingInputHash)).not.toEqual(
      base.frames.map(({mattingInputHash}) => mattingInputHash),
    );
    expect(changed.result.rawGenerationResultHash).toBe(base.result.rawGenerationResultHash);

    const wrongModelSpec = await mattingSpec(0.05, {
      modelId: 'fake-chroma-key-model',
      contentHash: 'f'.repeat(64),
    });
    expect(wrongModelSpec.processorSpecHash).not.toBe(base.result.processorSpecHash);
    await expect(new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: wrongModelSpec,
      processor: new ChromaKeyPoseFrameMattingProcessor(),
      stageCache: cache,
    }).execute(value.productionRequest, value.rawExecution.result)).rejects.toThrow(
      'Chroma Key Matting is algorithmic and does not accept a model identity',
    );
  });

  it('re-hashes Raw CAS bytes and publishes no Matted CAS on a detached Raw file', async () => {
    const value = await fixture();
    const firstRaw = value.rawExecution.result.frameResults[0]!.artifact.asset;
    await writeFile(join(value.rawRoot, `${firstRaw.contentHash}.png`), rawPng(3));
    const executor = new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: await mattingSpec(),
      processor: new ChromaKeyPoseFrameMattingProcessor(),
    });
    await expect(executor.execute(value.productionRequest, value.rawExecution.result)).rejects.toMatchObject({
      code: 'MATTING_RAW_CONTENT_HASH_MISMATCH',
    });
    await expect(readdir(value.mattedRoot)).resolves.toEqual([]);
  });

  it('rejects a fully re-hashed Matted artifact whose producer is detached from the Processor Spec', async () => {
    const value = await fixture();
    const spec = await mattingSpec();
    const execution = await new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec,
      processor: new ChromaKeyPoseFrameMattingProcessor(),
    }).execute(value.productionRequest, value.rawExecution.result);
    const originalFrame = execution.result.frameResults[0]!;
    const detachedProducer = {name: 'detached-matting', version: '9.9.9'};
    const artifactPayload = {
      stage: originalFrame.artifact.stage,
      inputHash: originalFrame.artifact.inputHash,
      producer: detachedProducer,
      asset: {
        ...originalFrame.artifact.asset,
        provenance: {
          ...originalFrame.artifact.asset.provenance!,
          producer: detachedProducer,
        },
      },
    };
    const artifact = {
      ...artifactPayload,
      outputHash: await hashPoseFrameArtifactPayload(artifactPayload),
    };
    const {resultHash: _frameResultHash, ...originalFramePayload} = originalFrame;
    const framePayload = {...originalFramePayload, artifact};
    const frameResult = {
      ...framePayload,
      resultHash: await hashPoseClipMattedFrameResultPayload(framePayload),
    };
    const {resultHash: _resultHash, ...originalPayload} = execution.result;
    const payload = {
      ...originalPayload,
      frameResults: [frameResult, ...execution.result.frameResults.slice(1)],
    };
    const detachedResult = {
      ...payload,
      resultHash: await hashPoseClipMattingResultPayload(payload),
    };
    await expect(assertPoseClipMattingResultIntegrity(
      value.productionRequest,
      value.rawExecution.result,
      spec,
      detachedResult,
    )).rejects.toMatchObject({code: 'MATTING_ASSET_BINDING_MISMATCH'});
  });

  it('rejects a fully opaque fake Matting output before Matted CAS publication', async () => {
    const value = await fixture();
    const opaqueProcessor: PoseFrameProcessor = {
      id: 'chroma-key-matting',
      version: '1.0.0',
      stage: 'matted',
      async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
        return {bytes: input.bytes};
      },
    };
    const executor = new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: await mattingSpec(),
      processor: opaqueProcessor,
    });
    await expect(executor.execute(value.productionRequest, value.rawExecution.result)).rejects.toMatchObject({
      code: 'MATTING_OUTPUT_ALPHA_OPAQUE',
    });
    await expect(readdir(value.mattedRoot)).resolves.toEqual([]);
  });

  it('validates every frame before publishing any Matted CAS artifact', async () => {
    const value = await fixture();
    const real = new ChromaKeyPoseFrameMattingProcessor();
    let calls = 0;
    const invalidFourth: PoseFrameProcessor = {
      id: real.id,
      version: real.version,
      stage: real.stage,
      async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
        calls += 1;
        return calls === 4 ? {bytes: input.bytes} : real.process(input);
      },
    };
    const executor = new PoseClipMattingExecutor({
      resolver: new LocalCasAssetByteResolver(value.rawRoot),
      cas: new LocalContentAddressedAssetStore(value.mattedRoot),
      spec: await mattingSpec(),
      processor: invalidFourth,
    });
    await expect(executor.execute(value.productionRequest, value.rawExecution.result)).rejects.toMatchObject({
      code: 'MATTING_OUTPUT_ALPHA_OPAQUE',
    });
    expect(calls).toBe(4);
    await expect(readdir(value.mattedRoot)).resolves.toEqual([]);
  });
});

describe('M4 Commit 3 Real Normalize', () => {
  it('normalizes four foreground bounds into a canonical RGBA canvas and reuses Stage Cache', async () => {
    const value = await normalizedFixture();
    const cache = new InMemoryPoseFrameStageCache();
    const executor = new PoseClipNormalizationExecutor({
      resolver: new LocalCasAssetByteResolver(value.mattedRoot),
      cas: new LocalContentAddressedAssetStore(value.normalizedRoot),
      mattingSpec: value.activeMattingSpec,
      spec: await normalizationSpec(),
      processor: new CanonicalCanvasPoseFrameNormalizer(),
      stageCache: cache,
      now: () => new Date('2026-08-22T02:00:00.000Z'),
    });
    const first = await executor.execute(
      value.productionRequest, value.rawExecution.result, value.mattingExecution.result,
    );
    expect(first.frames.map(({cache: status}) => status)).toEqual(['miss', 'miss', 'miss', 'miss']);
    expect(first.result.frameResults.map(({frameIndex}) => frameIndex)).toEqual([0, 1, 2, 3]);
    for (const frame of first.result.frameResults) {
      expect(frame.transform).toEqual({
        sourceBounds: {x: 1, y: 0, width: 1, height: 1},
        destinationBounds: {x: 2, y: 3, width: 4, height: 4},
        canvas: {width: 8, height: 8},
        scale: 4,
      });
      expect(frame.artifact.inputHash).toBe(
        value.mattingExecution.result.frameResults[frame.frameIndex]!.artifact.outputHash,
      );
      expect(frame.artifact.asset).toMatchObject({width: 8, height: 8, alphaMode: 'straight'});
      const bytes = new Uint8Array(await readFile(
        join(value.normalizedRoot, `${frame.artifact.asset.contentHash}.png`),
      ));
      const decoded = decodeRgbaPng8(bytes);
      expect(decoded.pixels.filter((_, index) => index % 4 === 3 && decoded.pixels[index]! > 0)).toHaveLength(16);
    }
    const second = await executor.execute(
      value.productionRequest, value.rawExecution.result, value.mattingExecution.result,
    );
    expect(second.frames.map(({cache: status}) => status)).toEqual(['hit', 'hit', 'hit', 'hit']);
    expect(second.result.resultHash).toBe(first.result.resultHash);
  });

  it('invalidates only Normalize identity when canonical sizing config changes', async () => {
    const value = await normalizedFixture();
    const cache = new InMemoryPoseFrameStageCache();
    const base = await new PoseClipNormalizationExecutor({
      resolver: new LocalCasAssetByteResolver(value.mattedRoot),
      cas: new LocalContentAddressedAssetStore(value.normalizedRoot),
      mattingSpec: value.activeMattingSpec,
      spec: await normalizationSpec(4),
      processor: new CanonicalCanvasPoseFrameNormalizer(),
      stageCache: cache,
    }).execute(value.productionRequest, value.rawExecution.result, value.mattingExecution.result);
    const changed = await new PoseClipNormalizationExecutor({
      resolver: new LocalCasAssetByteResolver(value.mattedRoot),
      cas: new LocalContentAddressedAssetStore(value.normalizedRoot),
      mattingSpec: value.activeMattingSpec,
      spec: await normalizationSpec(5),
      processor: new CanonicalCanvasPoseFrameNormalizer(),
      stageCache: cache,
    }).execute(value.productionRequest, value.rawExecution.result, value.mattingExecution.result);
    expect(changed.frames.every(({cache: status}) => status === 'miss')).toBe(true);
    expect(changed.result.processorSpecHash).not.toBe(base.result.processorSpecHash);
    expect(changed.frames.map(({normalizationInputHash}) => normalizationInputHash)).not.toEqual(
      base.frames.map(({normalizationInputHash}) => normalizationInputHash),
    );
    expect(changed.result.mattingResultHash).toBe(base.result.mattingResultHash);
  });

  it('re-hashes Matted CAS bytes before Normalize and publishes nothing when detached', async () => {
    const value = await normalizedFixture();
    const firstMatted = value.mattingExecution.result.frameResults[0]!.artifact.asset;
    await writeFile(join(value.mattedRoot, `${firstMatted.contentHash}.png`), rawPng(0));
    const executor = new PoseClipNormalizationExecutor({
      resolver: new LocalCasAssetByteResolver(value.mattedRoot),
      cas: new LocalContentAddressedAssetStore(value.normalizedRoot),
      mattingSpec: value.activeMattingSpec,
      spec: await normalizationSpec(),
      processor: new CanonicalCanvasPoseFrameNormalizer(),
    });
    await expect(executor.execute(
      value.productionRequest, value.rawExecution.result, value.mattingExecution.result,
    )).rejects.toMatchObject({code: 'NORMALIZATION_MATTED_CONTENT_HASH_MISMATCH'});
    await expect(readdir(value.normalizedRoot)).resolves.toEqual([]);
  });

  it('validates every normalized frame before the first Normalized CAS publication', async () => {
    const value = await normalizedFixture();
    const real = new CanonicalCanvasPoseFrameNormalizer();
    let calls = 0;
    const invalidFourth: PoseFrameNormalizer = {
      id: real.id,
      version: real.version,
      stage: real.stage,
      plan: (input) => real.plan(input),
      async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
        calls += 1;
        return calls === 4 ? {bytes: input.bytes} : real.process(input);
      },
    };
    const executor = new PoseClipNormalizationExecutor({
      resolver: new LocalCasAssetByteResolver(value.mattedRoot),
      cas: new LocalContentAddressedAssetStore(value.normalizedRoot),
      mattingSpec: value.activeMattingSpec,
      spec: await normalizationSpec(),
      processor: invalidFourth,
    });
    await expect(executor.execute(
      value.productionRequest, value.rawExecution.result, value.mattingExecution.result,
    )).rejects.toMatchObject({code: 'NORMALIZATION_OUTPUT_CANVAS_MISMATCH'});
    expect(calls).toBe(4);
    await expect(readdir(value.normalizedRoot)).resolves.toEqual([]);
  });

  it('rejects an out-of-canvas transform before any Normalized CAS publication', async () => {
    const value = await normalizedFixture();
    const real = new CanonicalCanvasPoseFrameNormalizer();
    let plans = 0;
    const invalidFourthPlan: PoseFrameNormalizer = {
      id: real.id,
      version: real.version,
      stage: real.stage,
      async plan(input: PoseFrameProcessorInput) {
        plans += 1;
        const transform = await real.plan(input);
        return plans === 4
          ? {...transform, destinationBounds: {...transform.destinationBounds, x: transform.canvas.width}}
          : transform;
      },
      process: (input) => real.process(input),
    };
    const executor = new PoseClipNormalizationExecutor({
      resolver: new LocalCasAssetByteResolver(value.mattedRoot),
      cas: new LocalContentAddressedAssetStore(value.normalizedRoot),
      mattingSpec: value.activeMattingSpec,
      spec: await normalizationSpec(),
      processor: invalidFourthPlan,
    });
    await expect(executor.execute(
      value.productionRequest, value.rawExecution.result, value.mattingExecution.result,
    )).rejects.toMatchObject({code: 'NORMALIZATION_TRANSFORM_INVALID'});
    expect(plans).toBe(4);
    await expect(readdir(value.normalizedRoot)).resolves.toEqual([]);
  });
});
