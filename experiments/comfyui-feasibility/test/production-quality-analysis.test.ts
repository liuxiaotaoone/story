import {describe, expect, it} from 'vitest';
import {sha256Bytes} from '@pose-clip/schemas';
import {
  QualityAnalysisIntegrityError,
  assertFrozenQualityAnalysisSource,
  assertQualityAnalysisResultHash,
  bindQualityAnalysisResult,
  qualityAnalysisSpecHash,
  verifyQualityAnalysisCasBytes,
  type FrozenProductionE2eManifest,
  type QualityAnalysisSourceReport,
  type QualityAnalysisSpec,
} from '../src/production-quality-analysis.js';

const stages = ['raw', 'matted', 'normalized', 'anchored'] as const;
const frameKeys = ['1', '2', '3', '4'].map(value => value.repeat(64));
const artifactHashes = stages.map((_, stageIndex) => (
  frameKeys.map((_, frameIndex) => (stageIndex + frameIndex + 5).toString(16).repeat(64))
));

const manifest: FrozenProductionE2eManifest = {
  status: 'PASS',
  admission: {
    workflowId: 'workflow',
    workflowHash: 'a'.repeat(64),
    modelCatalogHash: 'b'.repeat(64),
    referenceAssetHash: 'c'.repeat(64),
    productionRequestHash: 'd'.repeat(64),
    trustedProfileHash: 'e'.repeat(64),
  },
  frames: frameKeys.map((frameExecutionKey, frameIndex) => ({
    frameIndex,
    frameExecutionKey,
    artifacts: Object.fromEntries(stages.map((stage, stageIndex) => (
      [stage, artifactHashes[stageIndex]![frameIndex]!]
    ))) as Record<typeof stages[number], string>,
  })),
  production: {poseClipHash: 'f'.repeat(64), resultHash: '0'.repeat(64)},
};

const report: QualityAnalysisSourceReport = {
  status: 'PASS',
  plan: {
    workflow: {id: manifest.admission.workflowId, contentHash: manifest.admission.workflowHash},
    modelCatalogHash: manifest.admission.modelCatalogHash,
    referenceAsset: {contentHash: manifest.admission.referenceAssetHash},
    productionRequestHash: manifest.admission.productionRequestHash,
    trustedProfileHash: manifest.admission.trustedProfileHash,
    frameExecutionKeys: frameKeys,
  },
  production: {
    poseClipHash: manifest.production.poseClipHash,
    resultHash: manifest.production.resultHash,
  },
  frames: manifest.frames.map(frame => ({
    frameIndex: frame.frameIndex,
    frameExecutionKey: frame.frameExecutionKey,
    artifacts: stages.map(stage => ({stage, contentHash: frame.artifacts[stage]})),
  })),
};

const spec: QualityAnalysisSpec = {
  schemaVersion: '1.0.0',
  id: 'rgba-quality-baseline',
  version: '1.0.0',
  normalization: {
    processor: {name: 'canonical-canvas-normalize', version: '1.0.1'},
    config: {
      canvasWidth: 512,
      canvasHeight: 768,
      targetForegroundHeight: 640,
      maxForegroundWidth: 430,
      bottomPadding: 32,
      alphaThreshold: 8,
      resampling: 'bilinear-premultiplied',
    },
  },
  rgba: {
    alphaThreshold: 8,
    opaqueThreshold: 247,
    green: {minimum: 64, dominance: 24},
  },
};

describe('production quality analysis evidence', () => {
  it('accepts only a PASS report with all frozen identities and stage hashes', () => {
    expect(() => assertFrozenQualityAnalysisSource(manifest, report)).not.toThrow();

    const detached: QualityAnalysisSourceReport = {
      ...report,
      production: {...report.production!, poseClipHash: '9'.repeat(64)},
    };
    expect(() => assertFrozenQualityAnalysisSource(manifest, detached)).toThrow(/PoseClip hash/u);

    try {
      assertFrozenQualityAnalysisSource(manifest, detached);
      throw new Error('Expected frozen run mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(QualityAnalysisIntegrityError);
      expect((error as QualityAnalysisIntegrityError).code).toBe('QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH');
    }
  });

  it('rejects a detached artifact hash before reading or measuring CAS pixels', () => {
    const detached: QualityAnalysisSourceReport = {
      ...report,
      frames: report.frames!.map((frame, frameIndex) => frameIndex !== 2 ? frame : ({
        ...frame,
        artifacts: frame.artifacts.map((artifact, artifactIndex) => artifactIndex !== 1
          ? artifact
          : {...artifact, contentHash: '9'.repeat(64)}),
      })),
    };
    expect(() => assertFrozenQualityAnalysisSource(manifest, detached)).toThrow(
      /Frame 2 matted content hash/u,
    );
  });

  it('re-hashes CAS bytes and reports the exact frame and stage on mismatch', async () => {
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const expected = await sha256Bytes(bytes);
    await expect(verifyQualityAnalysisCasBytes(bytes, expected, 1, 'normalized')).resolves.toBe(expected);

    await expect(verifyQualityAnalysisCasBytes(bytes, '0'.repeat(64), 1, 'normalized')).rejects.toMatchObject({
      code: 'QUALITY_ANALYSIS_CAS_HASH_MISMATCH',
      frameIndex: 1,
      stage: 'normalized',
      expected: '0'.repeat(64),
      actual: expected,
    });
  });

  it('gives the analysis algorithm and result deterministic, change-sensitive identities', async () => {
    const firstSpecHash = await qualityAnalysisSpecHash(spec);
    expect(await qualityAnalysisSpecHash(structuredClone(spec))).toBe(firstSpecHash);
    expect(await qualityAnalysisSpecHash({
      ...spec,
      rgba: {...spec.rgba, green: {...spec.rgba.green, dominance: 30}},
    })).not.toBe(firstSpecHash);

    const first = await bindQualityAnalysisResult({sourcePoseClipHash: 'a'.repeat(64), frames: [{frameIndex: 0}]});
    const repeated = await bindQualityAnalysisResult({sourcePoseClipHash: 'a'.repeat(64), frames: [{frameIndex: 0}]});
    const changed = await bindQualityAnalysisResult({sourcePoseClipHash: 'a'.repeat(64), frames: [{frameIndex: 1}]});
    expect(repeated.analysisResultHash).toBe(first.analysisResultHash);
    expect(changed.analysisResultHash).not.toBe(first.analysisResultHash);
    await expect(assertQualityAnalysisResultHash(first)).resolves.toBeUndefined();
    await expect(assertQualityAnalysisResultHash({...first, analysisResultHash: '0'.repeat(64)})).rejects.toMatchObject({
      code: 'QUALITY_ANALYSIS_RESULT_HASH_MISMATCH',
    });
  });
});
