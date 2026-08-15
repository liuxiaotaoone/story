import {describe, expect, it} from 'vitest';
import {
  PoseClipProductionIntegrityError,
  PoseClipProductionRequestSchema,
  assertPoseClipProductionRequestIntegrity,
  assertPoseClipProductionResultIntegrity,
  createActionGenerationRequest,
  createPoseClipFrameSpec,
  createPoseClipProductionRequest,
  hashPoseClipContent,
  hashPoseClipFrameProductionResultPayload,
  hashPoseClipProductionResultPayload,
  hashPoseFrameArtifactPayload,
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

async function createFrameJob(frameIndex: number, poseIntent?: string): Promise<PoseClipFrameJob> {
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
  return {spec, generationRequest};
}

async function createRequest(): Promise<PoseClipProductionRequest> {
  const frames = await Promise.all(FRAME_DEFINITIONS.map((_, index) => createFrameJob(index)));
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
        uri: `file:///pose-production/${job.spec.frameIndex}/${stage}.png`,
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
  request: PoseClipProductionRequest,
  job: PoseClipFrameJob,
): Promise<PoseClipFrameProductionResult> {
  const artifacts = await createArtifacts(job);
  const framePayload = {
    schemaVersion: '1.0.0' as const,
    productionRequestHash: request.requestHash,
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

async function createResult(request: PoseClipProductionRequest): Promise<PoseClipProductionResult> {
  const frameResults = await Promise.all(request.frames.map((job) => createFrameResult(request, job)));
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
  it('keeps every frame independently generated, cached and bound to its FrameSpec', async () => {
    const request = await createRequest();
    expect(request.requestHash).toBe('32775cd0952e16f7ea35d919f66af25e521704aa16fd0c5fdc065727eca87d7e');
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
    expect(request.frames).toHaveLength(4);
    expect(new Set(request.frames.map(({spec}) => spec.frameSpecHash)).size).toBe(4);
    expect(new Set(request.frames.map(({generationRequest}) => generationRequest.inputHash)).size).toBe(4);
    expect(request.frames.every(({generationRequest}) => generationRequest.output.expectedCount === 1)).toBe(true);
    await expect(assertPoseClipProductionRequestIntegrity(request)).resolves.toEqual(request);

    const changedJob = await createFrameJob(0, 'Rabbit lowers its body before pushing off');
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

  it('fails closed when artifact bytes identity or required anchors no longer match evidence', async () => {
    const request = await createRequest();
    const tamperedArtifact = await createResult(request);
    tamperedArtifact.frameResults[0]!.artifacts[0]!.asset.contentHash = 'f'.repeat(64);
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
    const {requestHash: _oldRequestHash, ...requestPayload} = requiredAnchorRequest;
    const rebuiltRequest = await createPoseClipProductionRequest({
      ...requestPayload,
      frames: [{spec, generationRequest}, ...requiredAnchorRequest.frames.slice(1)],
    });
    const missingAnchorResult = await createResult(rebuiltRequest);
    await expect(assertPoseClipProductionResultIntegrity(rebuiltRequest, missingAnchorResult)).rejects.toMatchObject({
      code: 'REQUIRED_POSE_FRAME_ANCHOR_MISSING',
    });
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
  });
});
