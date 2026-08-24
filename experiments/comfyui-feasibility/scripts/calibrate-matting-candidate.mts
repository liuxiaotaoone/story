import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  AlphaGeometryPoseFrameAnchorDetector,
  BorderConnectedChromaKeyPoseFrameMattingProcessor,
  CanonicalCanvasPoseFrameNormalizer,
  LocalContentAddressedAssetStore,
  decodeRgbaPng8,
  rgbaAlphaRange,
} from '@pose-clip/asset-generation';
import {canonicalHash, createPoseFrameProcessorSpec} from '@pose-clip/schemas';
import {measureRgbaQuality, type RgbaQualityMeasurement} from '../src/production-e2e-report.ts';
import {
  assertQualityAnalysisResultHash,
  qualityAnalysisSpecHash,
  verifyQualityAnalysisCasBytes,
  type FrozenProductionE2eManifest,
  type QualityAnalysisSpec,
} from '../src/production-quality-analysis.ts';

interface BaselineFrame {
  readonly frameIndex: number;
  readonly frameExecutionKey: string;
  readonly normalizationTransform: {
    readonly sourceBounds: {readonly x: number; readonly y: number; readonly width: number; readonly height: number};
  };
  readonly stageQuality: {readonly anchored: RgbaQualityMeasurement};
}

interface BaselineQualityReport {
  readonly source: {readonly poseClipHash: string; readonly productionResultHash: string};
  readonly qualityAnalysisSpec: {readonly qualityAnalysisSpecHash: string};
  readonly frames: readonly BaselineFrame[];
  readonly analysisResultHash: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.env.M4_E2E_PASS_MANIFEST_PATH
  ?? resolve(root, 'frozen', 'production-e2e-pass-manifest.json');
const baselinePath = process.env.M4_QUALITY_REPORT_PATH
  ?? resolve(root, 'reports', 'production-quality-analysis.json');
const qualitySpecPath = process.env.M4_QUALITY_ANALYSIS_SPEC_PATH
  ?? resolve(root, 'frozen', 'rgba-quality-baseline-spec.json');
const candidateSpecPath = process.env.M4_MATTING_CANDIDATE_SPEC_PATH
  ?? resolve(root, 'calibration', 'chroma-key-matting-border-candidate-v1.json');
const rawCasRoot = process.env.M4_E2E_CAS_ROOT ?? resolve(root, 'generated', 'production-e2e', 'cas');
const candidateCasRoot = process.env.M4_MATTING_CANDIDATE_CAS_ROOT
  ?? resolve(root, 'generated', 'matting-calibration', 'cas');
const outputPath = process.env.M4_MATTING_CALIBRATION_REPORT_PATH
  ?? resolve(root, 'reports', 'matting-calibration.json');

const decodeJson = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

const [manifestBytes, baselineBytes, qualitySpecBytes, candidateSpecBytes] = await Promise.all([
  readFile(manifestPath),
  readFile(baselinePath),
  readFile(qualitySpecPath),
  readFile(candidateSpecPath),
]);
const manifest = decodeJson<FrozenProductionE2eManifest>(manifestBytes);
const baseline = decodeJson<BaselineQualityReport>(baselineBytes);
const qualitySpec = decodeJson<QualityAnalysisSpec>(qualitySpecBytes);
await assertQualityAnalysisResultHash(baseline);
if (
  manifest.status !== 'PASS'
  || baseline.source.poseClipHash !== manifest.production.poseClipHash
  || baseline.source.productionResultHash !== manifest.production.resultHash
  || baseline.frames.length !== manifest.frames.length
) throw new Error('MATTING_CALIBRATION_FROZEN_BASELINE_MISMATCH');
const expectedQualitySpecHash = await qualityAnalysisSpecHash(qualitySpec);
if (baseline.qualityAnalysisSpec.qualityAnalysisSpecHash !== expectedQualitySpecHash) {
  throw new Error('MATTING_CALIBRATION_QUALITY_SPEC_MISMATCH');
}

const candidateSpecInput = decodeJson<Parameters<typeof createPoseFrameProcessorSpec>[0]>(candidateSpecBytes);
const candidateSpec = await createPoseFrameProcessorSpec(candidateSpecInput);
const normalizationSpec = await createPoseFrameProcessorSpec({
  schemaVersion: qualitySpec.schemaVersion,
  stage: 'normalized',
  processor: qualitySpec.normalization.processor,
  config: qualitySpec.normalization.config,
});
const anchoringSpec = await createPoseFrameProcessorSpec({
  schemaVersion: '1.0.0',
  stage: 'anchored',
  processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
  config: {alphaThreshold: 8, footBandHeight: 12},
});
const matting = new BorderConnectedChromaKeyPoseFrameMattingProcessor();
if (
  candidateSpec.stage !== matting.stage
  || candidateSpec.processor.name !== matting.id
  || candidateSpec.processor.version !== matting.version
) throw new Error('MATTING_CALIBRATION_PROCESSOR_BINDING_INVALID');
const normalizer = new CanonicalCanvasPoseFrameNormalizer();
const anchorDetector = new AlphaGeometryPoseFrameAnchorDetector();
const candidateCas = new LocalContentAddressedAssetStore(candidateCasRoot);
const rgba = qualitySpec.rgba;
const measure = (bytes: Uint8Array): RgbaQualityMeasurement => measureRgbaQuality(
  decodeRgbaPng8(bytes),
  rgba.alphaThreshold,
  rgba.opaqueThreshold,
  rgba.green.minimum,
  rgba.green.dominance,
);

const frames = [];
for (const frozenFrame of manifest.frames) {
  const baselineFrame = baseline.frames[frozenFrame.frameIndex];
  if (
    baselineFrame === undefined
    || baselineFrame.frameIndex !== frozenFrame.frameIndex
    || baselineFrame.frameExecutionKey !== frozenFrame.frameExecutionKey
  ) throw new Error(`MATTING_CALIBRATION_FRAME_BINDING_MISMATCH:${frozenFrame.frameIndex}`);
  const rawHash = frozenFrame.artifacts.raw;
  const rawBytes = new Uint8Array(await readFile(resolve(rawCasRoot, `${rawHash}.png`)));
  await verifyQualityAnalysisCasBytes(rawBytes, rawHash, frozenFrame.frameIndex, 'raw');
  const mattedOutput = await matting.process({
    bytes: rawBytes,
    inputContentHash: rawHash,
    spec: candidateSpec,
  });
  const matted = await candidateCas.putPng(mattedOutput.bytes);
  const mattedDecoded = decodeRgbaPng8(matted.bytes);
  const alpha = rgbaAlphaRange(mattedDecoded.pixels);
  if (alpha.min !== 0 || alpha.max !== 255) throw new Error(
    `MATTING_CALIBRATION_ALPHA_RANGE_INVALID:${frozenFrame.frameIndex}:${alpha.min}:${alpha.max}`,
  );
  const normalizationTransform = await normalizer.plan({
    bytes: matted.bytes,
    inputContentHash: matted.contentHash,
    spec: normalizationSpec,
  });
  const normalizedOutput = await normalizer.process({
    bytes: matted.bytes,
    inputContentHash: matted.contentHash,
    spec: normalizationSpec,
  });
  const normalized = await candidateCas.putPng(normalizedOutput.bytes);
  const anchoredOutput = await anchorDetector.process({
    bytes: normalized.bytes,
    inputContentHash: normalized.contentHash,
    spec: anchoringSpec,
  });
  if (anchoredOutput.anchors === undefined) throw new Error(
    `MATTING_CALIBRATION_ANCHORS_MISSING:${frozenFrame.frameIndex}`,
  );
  const anchored = await candidateCas.putPng(anchoredOutput.bytes);
  const stageQuality = {
    matted: measure(matted.bytes),
    normalized: measure(normalized.bytes),
    anchored: measure(anchored.bytes),
  };
  const baselineQuality = baselineFrame.stageQuality.anchored;
  frames.push({
    frameIndex: frozenFrame.frameIndex,
    frozenFrameExecutionKey: frozenFrame.frameExecutionKey,
    sourceRawContentHash: rawHash,
    baseline: {
      mattedContentHash: frozenFrame.artifacts.matted,
      normalizedContentHash: frozenFrame.artifacts.normalized,
      anchoredContentHash: frozenFrame.artifacts.anchored,
      sourceBounds: baselineFrame.normalizationTransform.sourceBounds,
      anchoredQuality: baselineQuality,
    },
    candidate: {
      artifacts: {
        matted: matted.contentHash,
        normalized: normalized.contentHash,
        anchored: anchored.contentHash,
      },
      normalizationTransform,
      anchors: anchoredOutput.anchors,
      stageQuality,
    },
    delta: {
      foregroundCoverage: stageQuality.anchored.foregroundCoverage - baselineQuality.foregroundCoverage,
      meanAlpha: stageQuality.anchored.meanAlpha - baselineQuality.meanAlpha,
      softEdgeRatio: stageQuality.anchored.softEdgeRatio - baselineQuality.softEdgeRatio,
      visibleGreenSpillRatio: stageQuality.anchored.visibleGreenSpillRatio
        - baselineQuality.visibleGreenSpillRatio,
      edgeGreenSpillRatio: stageQuality.anchored.edgeGreenSpillRatio - baselineQuality.edgeGreenSpillRatio,
      opaqueGreenResidualRatio: stageQuality.anchored.opaqueGreenResidualRatio
        - baselineQuality.opaqueGreenResidualRatio,
    },
  });
}

const automatedChecks = {
  allSourceBoundsDetachedFromFullCanvas: frames.every(({candidate}) => {
    const bounds = candidate.normalizationTransform.sourceBounds;
    return bounds.x > 0 || bounds.y > 0 || bounds.width < 512 || bounds.height < 768;
  }),
  allCoreAnchorsPresent: frames.every(({candidate}) => (
    candidate.anchors.foot !== undefined
    && candidate.anchors.center !== undefined
  )),
  allVisibleGreenSpillReduced: frames.every(({delta}) => delta.visibleGreenSpillRatio < 0),
  allEdgeGreenSpillReduced: frames.every(({delta}) => delta.edgeGreenSpillRatio < 0),
  allOpaqueGreenResidualReduced: frames.every(({delta}) => delta.opaqueGreenResidualRatio < 0),
  allForegroundRetained: frames.every(({candidate}) => candidate.stageQuality.anchored.foregroundCoverage > 0.05),
};
const downstreamDiagnostics = {
  allBilateralFootAnchorsPresent: frames.every(({candidate}) => (
    candidate.anchors.leftFoot !== undefined && candidate.anchors.rightFoot !== undefined
  )),
  framesMissingBilateralFootAnchors: frames
    .filter(({candidate}) => candidate.anchors.leftFoot === undefined || candidate.anchors.rightFoot === undefined)
    .map(({frameIndex}) => frameIndex),
};
const payload = {
  schemaVersion: '1.0.0' as const,
  gate: 'M4 Commit 8.2 — Real Matting Calibration',
  status: 'CANDIDATE_MEASURED' as const,
  source: {
    frozenPoseClipHash: manifest.production.poseClipHash,
    frozenProductionResultHash: manifest.production.resultHash,
    baselineAnalysisResultHash: baseline.analysisResultHash,
  },
  specs: {
    qualityAnalysisSpecHash: expectedQualitySpecHash,
    candidateMattingSpecHash: candidateSpec.processorSpecHash,
    normalizationProcessorSpecHash: normalizationSpec.processorSpecHash,
    anchoringProcessorSpecHash: anchoringSpec.processorSpecHash,
  },
  automatedChecks,
  automatedChecksPassed: Object.values(automatedChecks).every(Boolean),
  downstreamDiagnostics,
  visualApproval: 'pending' as const,
  frames,
};
const report = {
  ...payload,
  calibrationResultHash: await canonicalHash('pose-clip-matting-calibration-result-v1', payload),
};
await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
