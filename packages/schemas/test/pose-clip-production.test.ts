import {describe, expect, it} from 'vitest';
import {
  PoseClipProductionRequestSchema,
  PoseFrameArtifactSchema,
  assertPoseClipProductionRequestIntegrity,
  assertPoseClipProductionResultIntegrity,
  assertPoseFrameProcessorSpecIntegrity,
  contentAddressedAssetUri,
  createActionGenerationRequest,
  createPoseClipFrameJob,
  createPoseClipFrameSpec,
  createPoseClipProductionRequest,
  createPoseFrameProcessorSpec,
  hashPoseClipContent,
  hashPoseClipFrameProductionResultPayload,
  hashPoseClipProductionResultPayload,
  hashPoseFrameArtifactPayload,
  poseFrameStageCacheKey,
} from '../src/index.js';
import type {
  PoseClipFrameJob,
  PoseClipFrameProductionResult,
  PoseClipProductionRequest,
  PoseClipProductionResult,
  PoseFrameArtifact,
} from '../src/index.js';

const REFERENCE_HASH = '1'.repeat(64);
const WORKFLOW_HASH = '2'.repeat(64);
const PRODUCER = {name: 'pose-clip-production-test', version: '1.0.0'};
const STAGES = ['raw', 'matted', 'normalized', 'anchored'] as const;

const FRAME_DEFINITIONS = [
  {phase: 'contact-left', contact: 'left-foot', referenceFoot: 'left-foot'},
  {phase: 'passing', contact: 'none', referenceFoot: 'auto'},
  {phase: 'contact-right', contact: 'right-foot', referenceFoot: 'right-foot'},
  {phase: 'airborne', contact: 'none', referenceFoot: 'auto'},
] as const;

async function createTestFrameJob(frameIndex: number, poseIntent?: string): Promise<PoseClipFrameJob> {
  const definition = FRAME_DEFINITIONS[frameIndex]!;
  const requiredAnchors = ['foot', 'center'];
  if (definition.contact === 'left-foot') requiredAnchors.push('leftFoot');
  if (definition.contact === 'right-foot') requiredAnchors.push('rightFoot');
  const referenceAssets = [{assetId: 'rabbit.reference', contentHash: REFERENCE_HASH}];
  const output = {assetId: `rabbit.run-left.${frameIndex + 1}`, kind: 'animal-frame' as const};
  const spec = await createPoseClipFrameSpec({
    frameIndex,
    phase: definition.phase,
    poseIntent: poseIntent ?? `Rabbit run cycle phase ${frameIndex + 1}`,
    durationFrames: 3,
    contact: definition.contact,
    referenceFoot: definition.referenceFoot,
    requiredAnchors,
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
    workflowHash: WORKFLOW_HASH,
    provider: 'comfyui',
    runtimeModels: [
      {role: 'diffusion-model', modelId: 'flux-2.safetensors', contentHash: '3'.repeat(64)},
      {role: 'text-encoder', modelId: 'qwen.safetensors', contentHash: '4'.repeat(64)},
      {role: 'vae', modelId: 'flux2-vae.safetensors', contentHash: '5'.repeat(64)},
    ],
    prompt: 'A whole-body paper-cut rabbit running left on a transparent background.',
    negativePrompt: 'cropped feet, extra limbs, inconsistent costume',
    seed: spec.seed,
    referenceAssets,
    output: {...output, nodeId: '17', expectedCount: 1},
  });
  return createPoseClipFrameJob({spec, generationRequest});
}

async function createRequest(): Promise<PoseClipProductionRequest> {
  const frames = await Promise.all(FRAME_DEFINITIONS.map((_, index) => createTestFrameJob(index)));
  return createPoseClipProductionRequest({
    schemaVersion: '1.0.0',
    id: 'production.rabbit.run-left.v1',
    actionPackageId: 'rabbit.run',
    poseClipId: 'rabbit.run-left',
    entityType: 'rabbit',
    action: 'run',
    direction: 'left',
    loop: true,
    rootMotion: {mode: 'timeline'},
    groundLock: {mode: 'contact-only', maxCorrectionPx: 32},
    tags: ['locomotion'],
    frames,
  });
}

function contentHash(frameIndex: number, stageIndex: number): string {
  return ((frameIndex * STAGES.length + stageIndex + 6) % 10).toString().repeat(64);
}

async function createArtifacts(job: PoseClipFrameJob): Promise<PoseFrameArtifact[]> {
  const artifacts: PoseFrameArtifact[] = [];
  let inputHash = job.generationRequest.inputHash;
  for (const [stageIndex, stage] of STAGES.entries()) {
    const finalStage = stage === 'anchored';
    const artifactPayload = {
      stage,
      inputHash,
      producer: PRODUCER,
      asset: {
        id: finalStage ? job.spec.output.assetId : `${job.spec.output.assetId}.${stage}`,
        uri: contentAddressedAssetUri(contentHash(job.spec.frameIndex, stageIndex)),
        contentHash: contentHash(job.spec.frameIndex, stageIndex),
        source: 'manual' as const,
        qaStatus: 'passed' as const,
        kind: job.spec.output.kind,
        width: 768,
        height: 1024,
        alphaMode: 'straight' as const,
      },
    };
    const artifact = {
      ...artifactPayload,
      outputHash: await hashPoseFrameArtifactPayload(artifactPayload),
    };
    artifacts.push(artifact);
    inputHash = artifact.outputHash;
  }
  return artifacts;
}

async function createFrameResult(
  job: PoseClipFrameJob,
): Promise<PoseClipFrameProductionResult> {
  const artifacts = await createArtifacts(job);
  const framePayload = {
    schemaVersion: '1.0.0' as const,
    frameJobHash: job.frameJobHash,
    frameIndex: job.spec.frameIndex,
    frameSpecHash: job.spec.frameSpecHash,
    generationInputHash: job.generationRequest.inputHash,
    artifacts,
    poseFrame: {
      assetId: job.spec.output.assetId,
      durationFrames: job.spec.durationFrames,
      anchors: {
        foot: {x: 0.5, y: 0.94},
        leftFoot: {x: 0.43, y: 0.94},
        rightFoot: {x: 0.57, y: 0.94},
        center: {x: 0.5, y: 0.5},
      },
      contact: {type: job.spec.contact},
      referenceFoot: job.spec.referenceFoot,
    },
    qa: {
      structural: 'passed' as const,
      matting: 'passed' as const,
      normalization: 'passed' as const,
      anchors: 'passed' as const,
      productionReady: true,
      diagnostics: [],
    },
  };
  return {
    ...framePayload,
    resultHash: await hashPoseClipFrameProductionResultPayload(framePayload),
  };
}

async function createResult(
  request: PoseClipProductionRequest,
  existingFrameResults?: PoseClipFrameProductionResult[],
): Promise<PoseClipProductionResult> {
  const frameResults = existingFrameResults
    ?? await Promise.all(request.frames.map((job) => createFrameResult(job)));
  const poseClip = {
    id: request.poseClipId,
    entityType: request.entityType,
    action: request.action,
    loop: request.loop,
    direction: request.direction,
    frames: frameResults.map(({poseFrame}) => poseFrame),
    rootMotion: request.rootMotion,
    groundLock: request.groundLock,
    tags: request.tags,
  };
  const resultPayload = {
    schemaVersion: '1.0.0' as const,
    productionRequestHash: request.requestHash,
    frameResults,
    poseClip,
    poseClipHash: await hashPoseClipContent(poseClip),
    producer: PRODUCER,
    qa: {
      structural: 'passed' as const,
      continuity: 'passed' as const,
      anchors: 'passed' as const,
      identityConsistency: 'passed' as const,
      scaleConsistency: 'passed' as const,
      canvasConsistency: 'passed' as const,
      bodyProportion: 'passed' as const,
      footContact: 'passed' as const,
      anchorMovement: 'passed' as const,
      silhouetteContinuity: 'passed' as const,
      loopClosure: 'passed' as const,
      humanReview: 'approved' as const,
      productionReady: true,
      diagnostics: [],
    },
  };
  return {
    ...resultPayload,
    resultHash: await hashPoseClipProductionResultPayload(resultPayload),
  };
}

describe('M3 PoseClip production contract', () => {
  it('binds processor configuration and upstream bytes into independent stage cache identity', async () => {
    const spec = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'matted',
      processor: {name: 'rmbg', version: '1.0.0'},
      model: {modelId: 'rmbg-2.0', contentHash: 'a'.repeat(64)},
      config: {threshold: 0.5},
    });
    const cacheKey = await poseFrameStageCacheKey({
      stage: spec.stage,
      inputContentHash: 'b'.repeat(64),
      processorSpecHash: spec.processorSpecHash,
    });
    expect(spec.processorSpecHash).toBe('3a5299b31e0dfdfedc7a2f8954b2b5cb7590dc2f48e071c30f60c389b9490c77');
    expect(cacheKey).toBe('1d00b42d7789d0a8454d3b30b67a36c7dff8d0247d44d8d0bb96cd51dc6b9725');
    await expect(assertPoseFrameProcessorSpecIntegrity(spec)).resolves.toEqual(spec);
    const changed = await createPoseFrameProcessorSpec({
      schemaVersion: '1.0.0',
      stage: 'matted',
      processor: {name: 'rmbg', version: '1.0.0'},
      model: {modelId: 'rmbg-2.0', contentHash: 'a'.repeat(64)},
      config: {threshold: 0.7},
    });
    expect(changed.processorSpecHash).not.toBe(spec.processorSpecHash);
    expect(await poseFrameStageCacheKey({
      stage: spec.stage,
      inputContentHash: 'c'.repeat(64),
      processorSpecHash: spec.processorSpecHash,
    })).not.toBe(cacheKey);
  });

  it('keeps every frame independently generated, cached and bound to its FrameSpec', async () => {
    const request = await createRequest();
    expect(request.requestHash).toBe('c1248b8a854e368cb9c53f57eafb6684de07b5c08bfad6bd3af19eb83402f139');
    expect(request.frames.map(({spec}) => spec.frameSpecHash)).toEqual([
      'dee1d32ef98621d7412e2a8bb1430c8007811040a27bf2f4cdffd08790efd783',
      'aa320ff7f816d52b9102f17f8d0a5c2866b7f84fc7543b3af0fb2d3c8cddb63e',
      '6998db6699204921ecb6c37b8b24ccd066cb24f08cd292e21f6cf12fdb546840',
      '1f50d6e76b8f8709b54e8353837ad7ccc32cac0baca5074b38923ed5cf2661ea',
    ]);
    expect(request.frames.map(({generationRequest}) => generationRequest.inputHash)).toEqual([
      'a450bef9bf7a2b34ac49db2dd0aa18e1668c8fbba1e5455b75ca5f5d3ece2dbc',
      '2d62e165d39c4b237c2e3f57d4181c20bc828f82fa3659befcc4f7056a732315',
      '048b4f75521a1b2bf774bb575bc32628f6b2f49bc3e83581a3b1c591635fe599',
      '3175efed21e74ed071a509a0bfef71ed74ee39f23f8e7e9ad8938fdffa1c7881',
    ]);
    expect(request.frames.map(({frameJobHash}) => frameJobHash)).toEqual([
      'd32fbf582548c0436154980c3f1a9d22bb647d1a1b703895bf7ddd9d5aa9663b',
      '873de09d154e7a957152ae0b38d8000607fdb6090e975d7112970277b511afdc',
      '6c5a6acf37c29bb3061b3333fa77cdd7961dd3a89cd79de7705d4fc1eb2fd9cf',
      '715bdb9c0e5406548cf208f5229581a94b815049d844734758328d386e83eef6',
    ]);
    expect(new Set(request.frames.map(({frameJobHash}) => frameJobHash)).size).toBe(4);
    expect(request.frames).toHaveLength(4);
    expect(new Set(request.frames.map(({spec}) => spec.frameSpecHash)).size).toBe(4);
    expect(new Set(request.frames.map(({generationRequest}) => generationRequest.inputHash)).size).toBe(4);
    expect(request.frames.every(({generationRequest}) => generationRequest.output.expectedCount === 1)).toBe(true);
    await expect(assertPoseClipProductionRequestIntegrity(request)).resolves.toEqual(request);

    const changedJob = await createTestFrameJob(0, 'Rabbit lowers its body before pushing off');
    expect(changedJob.spec.frameSpecHash).not.toBe(request.frames[0]!.spec.frameSpecHash);
    expect(changedJob.generationRequest.inputHash).not.toBe(request.frames[0]!.generationRequest.inputHash);
  });

  it('rejects ambiguous frame order and duplicate output asset identities', async () => {
    const request = await createRequest();
    const nonContiguous = structuredClone(request);
    nonContiguous.frames[1]!.spec.frameIndex = 3;
    expect(PoseClipProductionRequestSchema.safeParse(nonContiguous).success).toBe(false);

    const duplicateOutput = structuredClone(request);
    duplicateOutput.frames[1]!.spec.output.assetId = duplicateOutput.frames[0]!.spec.output.assetId;
    duplicateOutput.frames[1]!.generationRequest.output.assetId = duplicateOutput.frames[0]!.spec.output.assetId;
    expect(PoseClipProductionRequestSchema.safeParse(duplicateOutput).success).toBe(false);
  });

  it('assembles a hash-verified PoseClip from four explicit artifact chains', async () => {
    const request = await createRequest();
    const result = await createResult(request);
    await expect(assertPoseClipProductionResultIntegrity(request, result)).resolves.toEqual(result);
    expect(result.frameResults.map(({artifacts}) => artifacts.map(({stage}) => stage))).toEqual([
      [...STAGES], [...STAGES], [...STAGES], [...STAGES],
    ]);
    expect(result.poseClip.frames.map(({assetId}) => assetId)).toEqual(
      request.frames.map(({spec}) => spec.output.assetId),
    );
  });

  it('reuses unchanged processed frame results after one FrameSpec changes', async () => {
    const originalRequest = await createRequest();
    const originalResult = await createResult(originalRequest);
    const changedJob = await createTestFrameJob(2, 'Rabbit extends its right leg at ground contact');
    const {requestHash: _requestHash, ...requestPayload} = originalRequest;
    const changedRequest = await createPoseClipProductionRequest({
      ...requestPayload,
      frames: originalRequest.frames.map((job, index) => index === 2 ? changedJob : job),
    });
    expect(changedRequest.requestHash).not.toBe(originalRequest.requestHash);
    expect(changedRequest.frames[0]!.frameJobHash).toBe(originalRequest.frames[0]!.frameJobHash);
    expect(changedRequest.frames[2]!.frameJobHash).not.toBe(originalRequest.frames[2]!.frameJobHash);

    const changedFrameResult = await createFrameResult(changedJob);
    const reusedFrameResults = originalResult.frameResults.map((result, index) => (
      index === 2 ? changedFrameResult : result
    ));
    const changedResult = await createResult(changedRequest, reusedFrameResults);
    await expect(assertPoseClipProductionResultIntegrity(changedRequest, changedResult)).resolves.toEqual(changedResult);
    expect(changedResult.frameResults[0]!.resultHash).toBe(originalResult.frameResults[0]!.resultHash);
    expect(changedResult.frameResults[1]!.resultHash).toBe(originalResult.frameResults[1]!.resultHash);
    expect(changedResult.frameResults[3]!.resultHash).toBe(originalResult.frameResults[3]!.resultHash);
  });

  it('fails closed when artifact bytes identity or required anchors no longer match evidence', async () => {
    const request = await createRequest();
    const tamperedArtifact = await createResult(request);
    tamperedArtifact.frameResults[0]!.artifacts[0]!.asset.contentHash = 'f'.repeat(64);
    tamperedArtifact.frameResults[0]!.artifacts[0]!.asset.uri = contentAddressedAssetUri('f'.repeat(64));
    await expect(assertPoseClipProductionResultIntegrity(request, tamperedArtifact)).rejects.toMatchObject({
      code: 'FRAME_ARTIFACT_HASH_MISMATCH',
    });

    const requiredAnchorRequest = await createRequest();
    const sourceJob = requiredAnchorRequest.frames[0]!;
    const {frameSpecHash: _oldFrameSpecHash, ...sourceSpecPayload} = sourceJob.spec;
    const spec = await createPoseClipFrameSpec({
      ...sourceSpecPayload,
      requiredAnchors: [...sourceJob.spec.requiredAnchors, 'auxiliary:ear-tip'],
    });
    const {inputHash: _oldInputHash, ...sourceGenerationPayload} = sourceJob.generationRequest;
    const generationRequest = await createActionGenerationRequest({
      ...sourceGenerationPayload,
      frameSpecHash: spec.frameSpecHash,
    });
    const frameJob = await createPoseClipFrameJob({spec, generationRequest});
    const {requestHash: _oldRequestHash, ...requestPayload} = requiredAnchorRequest;
    const rebuiltRequest = await createPoseClipProductionRequest({
      ...requestPayload,
      frames: [frameJob, ...requiredAnchorRequest.frames.slice(1)],
    });
    const missingAnchorResult = await createResult(rebuiltRequest);
    await expect(assertPoseClipProductionResultIntegrity(rebuiltRequest, missingAnchorResult)).rejects.toMatchObject({
      code: 'REQUIRED_POSE_FRAME_ANCHOR_MISSING',
    });
  });

  it('requires content-addressed identity for every production artifact', async () => {
    const request = await createRequest();
    const artifact = (await createArtifacts(request.frames[0]!))[0]!;
    expect(PoseFrameArtifactSchema.safeParse({
      ...artifact,
      asset: {...artifact.asset, uri: 'file:///disk-a/rabbit.png'},
    }).success).toBe(false);
  });

  it('records failed loop QA without falsely claiming production readiness', async () => {
    const request = await createRequest();
    const result = await createResult(request);
    const resultPayload = {
      ...result,
      resultHash: undefined,
      qa: {...result.qa, loopClosure: 'failed' as const, productionReady: false},
    };
    const {resultHash: _ignored, ...payload} = resultPayload;
    const failedQaResult = {
      ...payload,
      resultHash: await hashPoseClipProductionResultPayload(payload),
    };
    await expect(assertPoseClipProductionResultIntegrity(request, failedQaResult)).resolves.toEqual(failedQaResult);

    const notApplicablePayload = {
      ...payload,
      qa: {...result.qa, loopClosure: 'not-applicable' as const, productionReady: false},
    };
    const notApplicableResult = {
      ...notApplicablePayload,
      resultHash: await hashPoseClipProductionResultPayload(notApplicablePayload),
    };
    await expect(assertPoseClipProductionResultIntegrity(request, notApplicableResult)).rejects.toMatchObject({
      code: 'LOOP_CLOSURE_REQUIRED',
    });
  });
});
