import {describe, expect, it} from 'vitest';
import {
  PoseClipContinuityEvaluationSchema,
  PoseClipContinuityThresholdsSchema,
  assertPoseClipContinuityEvaluationIntegrity,
  assertPoseClipContinuityFeatureExtractorSpecIntegrity,
  assertPoseClipContinuityQaSpecIntegrity,
  createPoseClipContinuityFeatureExtractorSpec,
  createPoseClipContinuityQaSpec,
  hashPoseClipContinuityEvaluationPayload,
} from '../src/index.js';

const THRESHOLDS = {
  identityConsistency: {warning: 0.1, failure: 0.2},
  scaleConsistency: {warning: 0.1, failure: 0.2},
  canvasConsistency: {warning: 0, failure: 0.5},
  bodyProportion: {warning: 0.1, failure: 0.2},
  footContact: {warning: 0.02, failure: 0.05},
  anchorMovement: {warning: 0.1, failure: 0.2},
  silhouetteContinuity: {warning: 0.1, failure: 0.2},
  loopClosure: {warning: 0.1, failure: 0.2},
};

async function specs() {
  const featureExtractor = await createPoseClipContinuityFeatureExtractorSpec({
    schemaVersion: '1.0.0',
    extractor: {name: 'continuity-features', version: '1.0.0'},
    model: {modelId: 'continuity.onnx', contentHash: 'a'.repeat(64)},
    config: {canvas: [768, 1024]},
  });
  const qa = await createPoseClipContinuityQaSpec({
    schemaVersion: '1.0.0',
    evaluator: {name: 'continuity-evaluator', version: '1.0.0'},
    featureExtractor,
    thresholds: THRESHOLDS,
  });
  return {featureExtractor, qa};
}

describe('M3 Continuity QA contract', () => {
  it('binds extractor model/config and thresholds into nested spec hashes', async () => {
    const {featureExtractor, qa} = await specs();
    await expect(assertPoseClipContinuityFeatureExtractorSpecIntegrity(featureExtractor)).resolves.toEqual(featureExtractor);
    await expect(assertPoseClipContinuityQaSpecIntegrity(qa)).resolves.toEqual(qa);
    await expect(assertPoseClipContinuityFeatureExtractorSpecIntegrity({
      ...featureExtractor,
      config: {canvas: [1024, 1024]},
    })).rejects.toMatchObject({code: 'CONTINUITY_EXTRACTOR_SPEC_HASH_MISMATCH'});
    await expect(assertPoseClipContinuityQaSpecIntegrity({
      ...qa,
      thresholds: {...qa.thresholds, footContact: {warning: 0.03, failure: 0.05}},
    })).rejects.toMatchObject({code: 'CONTINUITY_QA_SPEC_HASH_MISMATCH'});
  });

  it('rejects inverted warning/failure thresholds', () => {
    expect(PoseClipContinuityThresholdsSchema.safeParse({
      ...THRESHOLDS,
      identityConsistency: {warning: 0.3, failure: 0.2},
    }).success).toBe(false);
  });

  it('hashes the evaluated frame-result set and enforces loop applicability', async () => {
    const {qa} = await specs();
    const passed = {status: 'passed' as const, maxDelta: 0, thresholds: {warning: 0.1, failure: 0.2}};
    const payload = {
      schemaVersion: '1.0.0' as const,
      continuityQaSpecHash: qa.continuityQaSpecHash,
      frameResultHashes: ['1'.repeat(64), '2'.repeat(64)],
      loop: false,
      metrics: {
        identityConsistency: passed,
        scaleConsistency: passed,
        canvasConsistency: passed,
        bodyProportion: passed,
        footContact: passed,
        anchorMovement: passed,
        silhouetteContinuity: passed,
        loopClosure: {
          status: 'not-applicable' as const,
          maxDelta: 0,
          thresholds: {warning: 0.1, failure: 0.2},
        },
      },
      continuity: 'passed' as const,
      automatedReady: true,
      diagnostics: [],
    };
    const evaluation = {
      ...payload,
      evaluationHash: await hashPoseClipContinuityEvaluationPayload(payload),
    };
    await expect(assertPoseClipContinuityEvaluationIntegrity(evaluation)).resolves.toEqual(evaluation);
    await expect(assertPoseClipContinuityEvaluationIntegrity({
      ...evaluation,
      frameResultHashes: ['1'.repeat(64), '3'.repeat(64)],
    })).rejects.toMatchObject({code: 'CONTINUITY_EVALUATION_HASH_MISMATCH'});
    expect(PoseClipContinuityEvaluationSchema.safeParse({
      ...evaluation,
      loop: true,
    }).success).toBe(false);
    expect(PoseClipContinuityEvaluationSchema.safeParse({
      ...evaluation,
      metrics: {
        ...evaluation.metrics,
        identityConsistency: {
          ...evaluation.metrics.identityConsistency,
          status: 'passed',
          maxDelta: 0.3,
        },
      },
    }).success).toBe(false);
  });
});
