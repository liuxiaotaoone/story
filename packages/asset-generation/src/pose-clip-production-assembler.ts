import {
  assertPoseClipContinuityEvaluationIntegrity,
  assertPoseClipFrameProductionResultIntegrity,
  assertPoseClipProductionRequestIntegrity,
  assertPoseClipProductionResultIntegrity,
  hashPoseClipContent,
  hashPoseClipProductionResultPayload,
  type PoseClipContinuityEvaluation,
  type PoseClipFrameProductionResult,
  type PoseClipProductionQa,
  type PoseClipProductionRequest,
  type PoseClipProductionResult,
  type ProducerRef,
} from '@pose-clip/schemas';

export interface AssemblePoseClipProductionResultInput {
  readonly request: PoseClipProductionRequest;
  readonly frameResults: readonly PoseClipFrameProductionResult[];
  readonly continuityEvaluation: PoseClipContinuityEvaluation;
  readonly producer: ProducerRef;
  readonly humanReview: 'pending' | 'approved' | 'rejected';
}

function aggregateFrameStatus(
  statuses: ReadonlyArray<PoseClipFrameProductionResult['qa']['structural']>,
): PoseClipProductionQa['structural'] {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.includes('pending')) return 'pending';
  return statuses.every((status) => status === 'not-applicable') ? 'not-applicable' : 'passed';
}

export async function assemblePoseClipProductionResult(
  input: AssemblePoseClipProductionResultInput,
): Promise<PoseClipProductionResult> {
  const request = await assertPoseClipProductionRequestIntegrity(input.request);
  if (input.frameResults.length !== request.frames.length) {
    throw new TypeError(`Expected ${request.frames.length} frame results, received ${input.frameResults.length}`);
  }
  const frameResults: PoseClipFrameProductionResult[] = [];
  for (const [index, frameResult] of input.frameResults.entries()) {
    frameResults.push(await assertPoseClipFrameProductionResultIntegrity(request.frames[index]!, frameResult));
  }
  const continuityEvaluation = await assertPoseClipContinuityEvaluationIntegrity(input.continuityEvaluation);
  if (
    continuityEvaluation.loop !== request.loop
    || continuityEvaluation.frameResultHashes.some((hash, index) => hash !== frameResults[index]?.resultHash)
    || continuityEvaluation.frameResultHashes.length !== frameResults.length
  ) throw new TypeError('Continuity Evaluation is not bound to the production frame results');

  const poseClip = {
    id: request.poseClipId,
    entityType: request.entityType,
    action: request.action,
    loop: request.loop,
    direction: request.direction,
    frames: frameResults.map(({poseFrame}) => poseFrame),
    rootMotion: request.rootMotion,
    groundLock: request.groundLock,
    ...(request.tags === undefined ? {} : {tags: request.tags}),
    ...(request.compositeSlots === undefined ? {} : {compositeSlots: request.compositeSlots}),
  };
  const metrics = continuityEvaluation.metrics;
  const diagnostics = [
    ...frameResults.flatMap(({qa}) => qa.diagnostics),
    ...continuityEvaluation.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.frameIndex === undefined ? {} : {frameIndex: diagnostic.frameIndex}),
      ...(diagnostic.comparedFrameIndex === undefined ? {} : {comparedFrameIndex: diagnostic.comparedFrameIndex}),
      stage: `continuity.${diagnostic.metric}`,
    })),
  ];
  const structural = aggregateFrameStatus(frameResults.map(({qa}) => qa.structural));
  const anchors = aggregateFrameStatus(frameResults.map(({qa}) => qa.anchors));
  const productionReady = (
    continuityEvaluation.automatedReady
    && frameResults.every(({qa: frameQa}) => frameQa.productionReady)
    && structural === 'passed'
    && anchors === 'passed'
    && input.humanReview === 'approved'
    && diagnostics.every(({severity}) => severity !== 'error')
  );
  const qa: PoseClipProductionQa = {
    structural,
    continuity: continuityEvaluation.continuity,
    anchors,
    identityConsistency: metrics.identityConsistency.status,
    scaleConsistency: metrics.scaleConsistency.status,
    canvasConsistency: metrics.canvasConsistency.status,
    bodyProportion: metrics.bodyProportion.status,
    footContact: metrics.footContact.status,
    anchorMovement: metrics.anchorMovement.status,
    silhouetteContinuity: metrics.silhouetteContinuity.status,
    loopClosure: metrics.loopClosure.status,
    humanReview: input.humanReview,
    productionReady,
    diagnostics,
  };
  const payload = {
    schemaVersion: '1.0.0' as const,
    productionRequestHash: request.requestHash,
    frameResults,
    poseClip,
    poseClipHash: await hashPoseClipContent(poseClip),
    producer: input.producer,
    continuityEvaluation,
    qa,
  };
  return assertPoseClipProductionResultIntegrity(request, {
    ...payload,
    resultHash: await hashPoseClipProductionResultPayload(payload),
  });
}
