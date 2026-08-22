import {
  assertPoseClipAnchoringResultIntegrity,
  assertPoseClipFrameProductionResultIntegrity,
  assertPoseFrameProcessorSpecIntegrity,
  assertPoseFrameQaEvaluatorSpecIntegrity,
  createPoseFrameQaEvaluatorSpec,
  hashPoseClipFrameProductionResultPayload,
  poseFrameExecutionKey,
  type PoseClipAnchoringResult,
  type PoseClipFrameProductionResult,
  type PoseClipMattingResult,
  type PoseClipNormalizationResult,
  type PoseClipRawGenerationRequest,
  type PoseClipRawGenerationResult,
  type PoseFrameProcessorSpec,
} from '@pose-clip/schemas';
import {
  POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
  RequiredAnchorPoseFrameQaEvaluator,
  type PoseFrameQaBinding,
} from './frame-production-executor.js';

export interface PoseClipFrameProductionBridgeOptions {
  readonly mattingSpec: PoseFrameProcessorSpec;
  readonly normalizationSpec: PoseFrameProcessorSpec;
  readonly anchoringSpec: PoseFrameProcessorSpec;
  readonly qa?: PoseFrameQaBinding;
}

export interface PoseClipFrameProductionBridgeInput {
  readonly request: PoseClipRawGenerationRequest;
  readonly rawResult: PoseClipRawGenerationResult;
  readonly mattingResult: PoseClipMattingResult;
  readonly normalizationResult: PoseClipNormalizationResult;
  readonly anchoringResult: PoseClipAnchoringResult;
}

export interface PoseClipFrameProductionBridgeResult {
  readonly frameResults: readonly PoseClipFrameProductionResult[];
}

export class PoseClipFrameProductionBridgeError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'PoseClipFrameProductionBridgeError';
  }
}

export class PoseClipFrameProductionBridge {
  constructor(private readonly options: PoseClipFrameProductionBridgeOptions) {}

  async #prepareQa(): Promise<PoseFrameQaBinding> {
    const binding = this.options.qa ?? {
      spec: await createPoseFrameQaEvaluatorSpec({
        schemaVersion: '1.0.0',
        evaluator: {name: 'required-anchor-frame-qa', version: '1.0.0'},
        config: {},
      }),
      evaluator: new RequiredAnchorPoseFrameQaEvaluator(),
    };
    const spec = await assertPoseFrameQaEvaluatorSpecIntegrity(binding.spec);
    if (
      binding.evaluator.id !== spec.evaluator.name
      || binding.evaluator.version !== spec.evaluator.version
    ) throw new PoseClipFrameProductionBridgeError(
      'FRAME_BRIDGE_QA_BINDING_INVALID',
      `Expected ${spec.evaluator.name}@${spec.evaluator.version}`,
    );
    return {spec, evaluator: binding.evaluator};
  }

  async execute(input: PoseClipFrameProductionBridgeInput): Promise<PoseClipFrameProductionBridgeResult> {
    const anchoringResult = await assertPoseClipAnchoringResultIntegrity(
      input.request,
      input.rawResult,
      this.options.mattingSpec,
      input.mattingResult,
      this.options.normalizationSpec,
      input.normalizationResult,
      this.options.anchoringSpec,
      input.anchoringResult,
    );
    const [mattingSpec, normalizationSpec, anchoringSpec, qa] = await Promise.all([
      assertPoseFrameProcessorSpecIntegrity(this.options.mattingSpec),
      assertPoseFrameProcessorSpecIntegrity(this.options.normalizationSpec),
      assertPoseFrameProcessorSpecIntegrity(this.options.anchoringSpec),
      this.#prepareQa(),
    ]);
    if (
      mattingSpec.stage !== 'matted'
      || normalizationSpec.stage !== 'normalized'
      || anchoringSpec.stage !== 'anchored'
    ) throw new PoseClipFrameProductionBridgeError(
      'FRAME_BRIDGE_PROCESSOR_PIPELINE_INVALID',
      'Expected matted, normalized and anchored Processor Specs',
    );

    const frameResults: PoseClipFrameProductionResult[] = [];
    for (const [frameIndex, frameJob] of input.request.frames.entries()) {
      const anchoredFrame = anchoringResult.frameResults[frameIndex]!;
      const artifacts = [
        input.rawResult.frameResults[frameIndex]!.artifact,
        input.mattingResult.frameResults[frameIndex]!.artifact,
        input.normalizationResult.frameResults[frameIndex]!.artifact,
        anchoredFrame.artifact,
      ];
      const frameExecutionKey = await poseFrameExecutionKey({
        frameJobHash: frameJob.frameJobHash,
        processorSpecHashes: {
          matted: mattingSpec.processorSpecHash,
          normalized: normalizationSpec.processorSpecHash,
          anchored: anchoringSpec.processorSpecHash,
        },
        qaEvaluatorSpecHash: qa.spec.qaEvaluatorSpecHash,
        executor: POSE_FRAME_PRODUCTION_EXECUTOR_IDENTITY,
      });
      const frameQa = await qa.evaluator.evaluate({
        frameJob: structuredClone(frameJob),
        artifacts: structuredClone(artifacts),
        anchors: structuredClone(anchoredFrame.anchors),
        spec: structuredClone(qa.spec),
      });
      const framePayload = {
        schemaVersion: '1.0.0' as const,
        frameExecutionKey,
        frameJobHash: frameJob.frameJobHash,
        frameIndex,
        frameSpecHash: frameJob.spec.frameSpecHash,
        generationInputHash: frameJob.generationRequest.inputHash,
        artifacts,
        poseFrame: {
          assetId: anchoredFrame.artifact.asset.id,
          durationFrames: frameJob.spec.durationFrames,
          anchors: anchoredFrame.anchors,
          contact: {type: frameJob.spec.contact},
          referenceFoot: frameJob.spec.referenceFoot,
        },
        qa: frameQa,
      };
      frameResults.push(await assertPoseClipFrameProductionResultIntegrity(
        frameJob,
        {...framePayload, resultHash: await hashPoseClipFrameProductionResultPayload(framePayload)},
        frameExecutionKey,
      ));
    }
    return {frameResults};
  }
}
