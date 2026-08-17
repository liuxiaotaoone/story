import {
  PoseClipContinuityFrameFeaturesSchema,
  PoseClipContinuityIntegrityError,
  PoseClipFrameProductionResultSchema,
  assertPoseClipContinuityEvaluationIntegrity,
  assertPoseClipContinuityFeatureExtractorSpecIntegrity,
  assertPoseClipContinuityQaSpecIntegrity,
  hashPoseClipContinuityEvaluationPayload,
  hashPoseClipFrameProductionResultPayload,
  type ContinuityMetricName,
  type ContinuityMetricResult,
  type ContinuityMetricStatus,
  type ContinuityThreshold,
  type PoseClipContinuityDiagnostic,
  type PoseClipContinuityEvaluation,
  type PoseClipContinuityFeatureExtractorSpec,
  type PoseClipContinuityFrameFeatures,
  type PoseClipContinuityMetrics,
  type PoseClipContinuityQaSpec,
  type PoseClipFrameProductionResult,
  type Point,
} from '@pose-clip/schemas';

export interface PoseClipContinuityFeatureExtractorInput {
  readonly frameResult: PoseClipFrameProductionResult;
  readonly spec: PoseClipContinuityFeatureExtractorSpec;
}

export interface PoseClipContinuityFeatureExtractor {
  readonly id: string;
  readonly version: string;
  extract(input: PoseClipContinuityFeatureExtractorInput): Promise<PoseClipContinuityFrameFeatures>;
}

export interface PoseClipContinuityEvaluatorInput {
  readonly frameResults: readonly PoseClipFrameProductionResult[];
  readonly loop: boolean;
  readonly spec: PoseClipContinuityQaSpec;
}

interface FramePair {
  fromFrame: number;
  toFrame: number;
}

interface MetricObservation {
  delta: number;
  pair?: FramePair;
  frame?: number;
}

const METRIC_NAMES: readonly ContinuityMetricName[] = [
  'identityConsistency',
  'scaleConsistency',
  'canvasConsistency',
  'bodyProportion',
  'footContact',
  'anchorMovement',
  'silhouetteContinuity',
  'loopClosure',
];

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PoseClipContinuityIntegrityError('CONTINUITY_REFERENCE_CONFIG_INVALID', context);
  }
  return value as Record<string, unknown>;
}

export class DeterministicReferenceContinuityFeatureExtractor implements PoseClipContinuityFeatureExtractor {
  readonly id = 'reference-continuity-features';
  readonly version = '1.0.0';

  async extract(input: PoseClipContinuityFeatureExtractorInput): Promise<PoseClipContinuityFrameFeatures> {
    const config = asRecord(input.spec.config, 'Reference continuity extractor requires object config');
    if (!Array.isArray(config.frames)) throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_REFERENCE_CONFIG_INVALID',
      'Reference continuity extractor requires config.frames',
    );
    const frames = config.frames.map((frame) => PoseClipContinuityFrameFeaturesSchema.parse(frame));
    const feature = frames.find(({frameIndex}) => frameIndex === input.frameResult.frameIndex);
    if (feature === undefined) throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_REFERENCE_FEATURE_MISSING',
      `Frame ${input.frameResult.frameIndex}`,
    );
    return structuredClone(feature);
  }
}

function rmsDelta(left: readonly number[], right: readonly number[], context: string): number {
  if (left.length !== right.length) throw new PoseClipContinuityIntegrityError(
    'CONTINUITY_FEATURE_DIMENSION_MISMATCH',
    context,
  );
  const squared = left.reduce((sum, value, index) => sum + (value - right[index]!) ** 2, 0);
  return Math.sqrt(squared / left.length);
}

function pointDelta(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function scaleOf(feature: PoseClipContinuityFrameFeatures): number {
  return Math.sqrt(feature.subjectBounds.width * feature.subjectBounds.height);
}

function scaleDelta(left: PoseClipContinuityFrameFeatures, right: PoseClipContinuityFrameFeatures): number {
  const leftScale = scaleOf(left);
  const rightScale = scaleOf(right);
  return Math.abs(leftScale - rightScale) / Math.max(leftScale, rightScale);
}

function metricStatus(delta: number, threshold: ContinuityThreshold): Exclude<ContinuityMetricStatus, 'not-applicable'> {
  if (delta > threshold.failure) return 'failed';
  if (delta > threshold.warning) return 'warning';
  return 'passed';
}

function metricResult(
  observations: readonly MetricObservation[],
  thresholds: ContinuityThreshold,
  applicable = true,
): ContinuityMetricResult {
  if (!applicable || observations.length === 0) return {
    status: 'not-applicable',
    maxDelta: 0,
    thresholds,
  };
  const worst = observations.reduce((current, candidate) => (
    candidate.delta > current.delta ? candidate : current
  ));
  return {
    status: metricStatus(worst.delta, thresholds),
    maxDelta: worst.delta,
    thresholds,
    ...(worst.pair === undefined ? {} : {worstPair: worst.pair}),
    ...(worst.frame === undefined ? {} : {worstFrame: worst.frame}),
  };
}

function aggregateStatus(metrics: PoseClipContinuityMetrics): 'passed' | 'warning' | 'failed' {
  const statuses = Object.values(metrics)
    .map(({status}) => status)
    .filter((status) => status !== 'not-applicable');
  if (statuses.includes('failed')) return 'failed';
  return statuses.includes('warning') ? 'warning' : 'passed';
}

function diagnosticForMetric(
  metric: ContinuityMetricName,
  result: ContinuityMetricResult,
): PoseClipContinuityDiagnostic | undefined {
  if (result.status !== 'warning' && result.status !== 'failed') return undefined;
  return {
    code: `CONTINUITY_${metric.toUpperCase()}`,
    severity: result.status === 'failed' ? 'error' : 'warning',
    message: `${metric} delta ${result.maxDelta.toFixed(6)} exceeds ${result.status} threshold`,
    metric,
    ...(result.worstPair === undefined ? {} : {
      frameIndex: result.worstPair.fromFrame,
      comparedFrameIndex: result.worstPair.toFrame,
    }),
    ...(result.worstFrame === undefined ? {} : {frameIndex: result.worstFrame}),
  };
}

function contactPoint(result: PoseClipFrameProductionResult): Point | undefined {
  const anchors = result.poseFrame.anchors;
  switch (result.poseFrame.contact?.type ?? 'none') {
    case 'left-foot': return anchors.leftFoot;
    case 'right-foot': return anchors.rightFoot;
    case 'both':
      if (anchors.leftFoot === undefined || anchors.rightFoot === undefined) return undefined;
      return {
        x: (anchors.leftFoot.x + anchors.rightFoot.x) / 2,
        y: (anchors.leftFoot.y + anchors.rightFoot.y) / 2,
      };
    case 'none': return undefined;
  }
}

async function validatedFrameResults(
  inputs: readonly PoseClipFrameProductionResult[],
): Promise<PoseClipFrameProductionResult[]> {
  if (inputs.length < 2) throw new PoseClipContinuityIntegrityError(
    'CONTINUITY_FRAME_COUNT_INVALID',
    'Continuity QA requires at least two frame results',
  );
  const results: PoseClipFrameProductionResult[] = [];
  for (const [index, input] of inputs.entries()) {
    const result = PoseClipFrameProductionResultSchema.parse(input);
    if (result.frameIndex !== index) throw new PoseClipContinuityIntegrityError(
      'CONTINUITY_FRAME_ORDER_INVALID',
      `Expected frame ${index}, received ${result.frameIndex}`,
    );
    const {resultHash: _resultHash, ...payload} = result;
    if (await hashPoseClipFrameProductionResultPayload(payload) !== result.resultHash) {
      throw new PoseClipContinuityIntegrityError('CONTINUITY_FRAME_RESULT_HASH_MISMATCH', `Frame ${index}`);
    }
    results.push(result);
  }
  return results;
}

export class DeterministicPoseClipContinuityEvaluator {
  readonly id = 'deterministic-pose-clip-continuity';
  readonly version = '1.0.0';

  constructor(private readonly extractor: PoseClipContinuityFeatureExtractor) {}

  async evaluate(input: PoseClipContinuityEvaluatorInput): Promise<PoseClipContinuityEvaluation> {
    const spec = await assertPoseClipContinuityQaSpecIntegrity(input.spec);
    const extractorSpec = await assertPoseClipContinuityFeatureExtractorSpecIntegrity(spec.featureExtractor);
    if (spec.evaluator.name !== this.id || spec.evaluator.version !== this.version) {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_EVALUATOR_BINDING_MISMATCH',
        `Expected ${spec.evaluator.name}@${spec.evaluator.version}`,
      );
    }
    if (extractorSpec.extractor.name !== this.extractor.id || extractorSpec.extractor.version !== this.extractor.version) {
      throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_EXTRACTOR_BINDING_MISMATCH',
        `Expected ${extractorSpec.extractor.name}@${extractorSpec.extractor.version}`,
      );
    }

    const frameResults = await validatedFrameResults(input.frameResults);
    const features: PoseClipContinuityFrameFeatures[] = [];
    for (const result of frameResults) {
      const feature = PoseClipContinuityFrameFeaturesSchema.parse(await this.extractor.extract({
        frameResult: structuredClone(result),
        spec: structuredClone(extractorSpec),
      }));
      const finalAsset = result.artifacts[3]!.asset;
      if (
        feature.frameIndex !== result.frameIndex
        || feature.sourceContentHash !== finalAsset.contentHash
        || feature.canvas.width !== finalAsset.width
        || feature.canvas.height !== finalAsset.height
      ) throw new PoseClipContinuityIntegrityError(
        'CONTINUITY_FEATURE_BINDING_MISMATCH',
        `Frame ${result.frameIndex}`,
      );
      features.push(feature);
    }

    const adjacent = features.slice(0, -1).map((feature, index) => ({
      left: feature,
      right: features[index + 1]!,
      leftResult: frameResults[index]!,
      rightResult: frameResults[index + 1]!,
      pair: {fromFrame: index, toFrame: index + 1},
    }));
    const identityObservations = adjacent.map(({left, right, pair}) => ({
      delta: rmsDelta(left.identityEmbedding, right.identityEmbedding, `Identity ${pair.fromFrame}-${pair.toFrame}`), pair,
    }));
    const scaleObservations = adjacent.map(({left, right, pair}) => ({delta: scaleDelta(left, right), pair}));
    const canvasObservations = adjacent.map(({left, right, pair}) => ({
      delta: left.canvas.width === right.canvas.width && left.canvas.height === right.canvas.height ? 0 : 1,
      pair,
    }));
    const bodyObservations = adjacent.map(({left, right, pair}) => ({
      delta: rmsDelta(left.bodyProportions, right.bodyProportions, `Body ${pair.fromFrame}-${pair.toFrame}`), pair,
    }));
    const anchorObservations = adjacent.map(({leftResult, rightResult, pair}) => ({
      delta: Math.max(
        pointDelta(leftResult.poseFrame.anchors.foot, rightResult.poseFrame.anchors.foot),
        pointDelta(leftResult.poseFrame.anchors.center, rightResult.poseFrame.anchors.center),
      ),
      pair,
    }));
    const silhouetteObservations = adjacent.map(({left, right, pair}) => ({
      delta: rmsDelta(left.silhouetteEmbedding, right.silhouetteEmbedding, `Silhouette ${pair.fromFrame}-${pair.toFrame}`), pair,
    }));
    const footObservations = frameResults.flatMap((result) => {
      const contact = contactPoint(result);
      return contact === undefined ? [] : [{
        delta: pointDelta(contact, result.poseFrame.anchors.foot),
        frame: result.frameIndex,
      }];
    });

    let loopObservations: MetricObservation[] = [];
    if (input.loop) {
      const firstFeature = features[0]!;
      const lastFeature = features.at(-1)!;
      const firstResult = frameResults[0]!;
      const lastResult = frameResults.at(-1)!;
      loopObservations = [{
        delta: Math.max(
          rmsDelta(lastFeature.identityEmbedding, firstFeature.identityEmbedding, 'Loop identity'),
          scaleDelta(lastFeature, firstFeature),
          rmsDelta(lastFeature.bodyProportions, firstFeature.bodyProportions, 'Loop body'),
          pointDelta(lastResult.poseFrame.anchors.foot, firstResult.poseFrame.anchors.foot),
          pointDelta(lastResult.poseFrame.anchors.center, firstResult.poseFrame.anchors.center),
          rmsDelta(lastFeature.silhouetteEmbedding, firstFeature.silhouetteEmbedding, 'Loop silhouette'),
        ),
        pair: {fromFrame: lastResult.frameIndex, toFrame: firstResult.frameIndex},
      }];
    }

    const thresholds = spec.thresholds;
    const metrics: PoseClipContinuityMetrics = {
      identityConsistency: metricResult(identityObservations, thresholds.identityConsistency),
      scaleConsistency: metricResult(scaleObservations, thresholds.scaleConsistency),
      canvasConsistency: metricResult(canvasObservations, thresholds.canvasConsistency),
      bodyProportion: metricResult(bodyObservations, thresholds.bodyProportion),
      footContact: metricResult(footObservations, thresholds.footContact, footObservations.length > 0),
      anchorMovement: metricResult(anchorObservations, thresholds.anchorMovement),
      silhouetteContinuity: metricResult(silhouetteObservations, thresholds.silhouetteContinuity),
      loopClosure: metricResult(loopObservations, thresholds.loopClosure, input.loop),
    };
    const continuity = aggregateStatus(metrics);
    const diagnostics = METRIC_NAMES
      .map((metric) => diagnosticForMetric(metric, metrics[metric]))
      .filter((diagnostic): diagnostic is PoseClipContinuityDiagnostic => diagnostic !== undefined);
    const payload = {
      schemaVersion: '1.0.0' as const,
      continuityQaSpecHash: spec.continuityQaSpecHash,
      frameResultHashes: frameResults.map(({resultHash}) => resultHash),
      loop: input.loop,
      metrics,
      continuity,
      automatedReady: continuity === 'passed' && frameResults.every(({qa}) => qa.productionReady),
      diagnostics,
    };
    return assertPoseClipContinuityEvaluationIntegrity({
      ...payload,
      evaluationHash: await hashPoseClipContinuityEvaluationPayload(payload),
    });
  }
}
