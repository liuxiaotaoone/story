import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  AlphaGeometryPoseFrameAnchorDetector,
  BilateralAlphaGeometryPoseFrameAnchorDetector,
  DeterministicPoseClipContinuityEvaluator,
  LocalCasAssetByteResolver,
  LocalContentAddressedAssetStore,
  RgbaPoseClipContinuityFeatureExtractor,
  decodeRgbaPng8,
  inspectPng,
} from '@pose-clip/asset-generation';
import {
  canonicalHash,
  contentAddressedAssetUri,
  createPoseClipContinuityFeatureExtractorSpec,
  createPoseClipContinuityQaSpec,
  createPoseFrameProcessorSpec,
  hashPoseClipFrameProductionResultPayload,
  hashPoseFrameArtifactPayload,
  sha256Bytes,
  type PoseAnchors,
  type PoseClipFrameProductionResult,
  type PoseFrameArtifact,
  type ProducerRef,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import {type FrozenProductionE2eManifest} from '../src/production-quality-analysis.ts';

interface MattingCalibrationFrame {
  readonly frameIndex: number;
  readonly frozenFrameExecutionKey: string;
  readonly sourceRawContentHash: string;
  readonly candidate: {
    readonly artifacts: {readonly matted: string; readonly normalized: string; readonly anchored: string};
    readonly anchors: PoseAnchors;
  };
}

interface MattingCalibrationReport {
  readonly status: string;
  readonly source: {
    readonly frozenPoseClipHash: string;
    readonly frozenProductionResultHash: string;
  };
  readonly specs: {
    readonly candidateMattingSpecHash: string;
    readonly normalizationProcessorSpecHash: string;
    readonly anchoringProcessorSpecHash: string;
  };
  readonly automatedChecksPassed: boolean;
  readonly frames: readonly MattingCalibrationFrame[];
  readonly calibrationResultHash: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.env.M4_E2E_PASS_MANIFEST_PATH
  ?? resolve(root, 'frozen', 'production-e2e-pass-manifest.json');
const mattingReportPath = process.env.M4_MATTING_CALIBRATION_REPORT_PATH
  ?? resolve(root, 'reports', 'matting-calibration.json');
const candidateSpecPath = process.env.M4_ANCHOR_CANDIDATE_SPEC_PATH
  ?? resolve(root, 'calibration', 'alpha-geometry-anchor-bilateral-candidate-v1.json');
const rawCasRoot = process.env.M4_E2E_CAS_ROOT ?? resolve(root, 'generated', 'production-e2e', 'cas');
const mattingCasRoot = process.env.M4_MATTING_CANDIDATE_CAS_ROOT
  ?? resolve(root, 'generated', 'matting-calibration', 'cas');
const candidateCasRoot = process.env.M4_ANCHOR_CANDIDATE_CAS_ROOT
  ?? resolve(root, 'generated', 'anchor-calibration', 'cas');
const outputPath = process.env.M4_ANCHOR_CALIBRATION_REPORT_PATH
  ?? resolve(root, 'reports', 'anchor-calibration.json');

const decodeJson = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
const [manifestBytes, mattingReportBytes, candidateSpecBytes] = await Promise.all([
  readFile(manifestPath),
  readFile(mattingReportPath),
  readFile(candidateSpecPath),
]);
const manifest = decodeJson<FrozenProductionE2eManifest>(manifestBytes);
const mattingReport = decodeJson<MattingCalibrationReport>(mattingReportBytes);
const {calibrationResultHash: recordedMattingResultHash, ...mattingPayload} = mattingReport;
const actualMattingResultHash = await canonicalHash('pose-clip-matting-calibration-result-v1', mattingPayload);
if (actualMattingResultHash !== recordedMattingResultHash) {
  throw new Error('ANCHOR_CALIBRATION_MATTING_RESULT_HASH_MISMATCH');
}
if (
  manifest.status !== 'PASS'
  || mattingReport.status !== 'CANDIDATE_MEASURED'
  || !mattingReport.automatedChecksPassed
  || mattingReport.source.frozenPoseClipHash !== manifest.production.poseClipHash
  || mattingReport.source.frozenProductionResultHash !== manifest.production.resultHash
  || mattingReport.frames.length !== manifest.frames.length
) throw new Error('ANCHOR_CALIBRATION_FROZEN_SOURCE_MISMATCH');

const baselineSpec = await createPoseFrameProcessorSpec({
  schemaVersion: '1.0.0',
  stage: 'anchored',
  processor: {name: 'alpha-geometry-anchor', version: '1.0.1'},
  config: {alphaThreshold: 8, footBandHeight: 12},
});
if (baselineSpec.processorSpecHash !== mattingReport.specs.anchoringProcessorSpecHash) {
  throw new Error('ANCHOR_CALIBRATION_BASELINE_SPEC_MISMATCH');
}
const candidateSpecInput = decodeJson<Parameters<typeof createPoseFrameProcessorSpec>[0]>(candidateSpecBytes);
const candidateSpec = await createPoseFrameProcessorSpec(candidateSpecInput);
const baselineDetector = new AlphaGeometryPoseFrameAnchorDetector();
const candidateDetector = new BilateralAlphaGeometryPoseFrameAnchorDetector();
if (
  candidateSpec.stage !== candidateDetector.stage
  || candidateSpec.processor.name !== candidateDetector.id
  || candidateSpec.processor.version !== candidateDetector.version
) throw new Error('ANCHOR_CALIBRATION_PROCESSOR_BINDING_INVALID');

const continuityFeatureSpec = await createPoseClipContinuityFeatureExtractorSpec({
  schemaVersion: '1.0.0',
  extractor: {name: 'rgba-continuity-features', version: '1.0.0'},
  config: {alphaThreshold: 8, colorBins: 8, silhouetteGridSize: 8},
});
const collectionThreshold = {warning: 1, failure: 2};
const continuityQaSpec = await createPoseClipContinuityQaSpec({
  schemaVersion: '1.0.0',
  evaluator: {name: 'deterministic-pose-clip-continuity', version: '1.0.0'},
  featureExtractor: continuityFeatureSpec,
  thresholds: {
    identityConsistency: collectionThreshold,
    scaleConsistency: collectionThreshold,
    canvasConsistency: collectionThreshold,
    bodyProportion: collectionThreshold,
    footContact: collectionThreshold,
    anchorMovement: collectionThreshold,
    silhouetteContinuity: collectionThreshold,
    loopClosure: collectionThreshold,
  },
});

const candidateCas = new LocalContentAddressedAssetStore(candidateCasRoot);
const candidateResolver = new LocalCasAssetByteResolver(candidateCasRoot);
const continuityEvaluator = new DeterministicPoseClipContinuityEvaluator(
  new RgbaPoseClipContinuityFeatureExtractor(candidateResolver),
);
const processorForStage: Readonly<Record<'raw' | 'matted' | 'normalized' | 'anchored', ProducerRef>> = {
  raw: {name: 'frozen-real-gpu-generation', version: '1.0.0'},
  matted: {name: 'chroma-key-matting', version: '1.1.0'},
  normalized: {name: 'canonical-canvas-normalize', version: '1.0.1'},
  anchored: {name: candidateDetector.id, version: candidateDetector.version},
};

function inUnitInterval({x, y}: {readonly x: number; readonly y: number}): boolean {
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

function allAnchorsInUnitInterval(anchors: PoseAnchors): boolean {
  return Object.entries(anchors).every(([name, value]) => {
    if (name === 'auxiliary') return Object.values(value as Record<string, {x: number; y: number}>)
      .every(inUnitInterval);
    return inUnitInterval(value as {x: number; y: number});
  });
}

function visualAsset(
  id: string,
  contentHash: string,
  width: number,
  height: number,
  alphaMode: 'opaque' | 'straight',
): VisualAssetRecord {
  return {
    id,
    uri: contentAddressedAssetUri(contentHash),
    contentHash,
    source: 'manual',
    qaStatus: 'pending',
    kind: 'animal-frame',
    width,
    height,
    alphaMode,
  };
}

async function artifact(
  stage: 'raw' | 'matted' | 'normalized' | 'anchored',
  inputHash: string,
  asset: VisualAssetRecord,
): Promise<PoseFrameArtifact> {
  const payload = {stage, inputHash, producer: processorForStage[stage], asset};
  return {...payload, outputHash: await hashPoseFrameArtifactPayload(payload)};
}

const frames = [];
const continuityFrameResults: PoseClipFrameProductionResult[] = [];
for (const [offset, frozenFrame] of manifest.frames.entries()) {
  const source = mattingReport.frames[offset];
  if (
    source === undefined
    || source.frameIndex !== frozenFrame.frameIndex
    || source.frozenFrameExecutionKey !== frozenFrame.frameExecutionKey
    || source.sourceRawContentHash !== frozenFrame.artifacts.raw
  ) throw new Error(`ANCHOR_CALIBRATION_FRAME_BINDING_MISMATCH:${frozenFrame.frameIndex}`);

  const [rawBuffer, mattedBuffer, normalizedBuffer] = await Promise.all([
    readFile(resolve(rawCasRoot, `${source.sourceRawContentHash}.png`)),
    readFile(resolve(mattingCasRoot, `${source.candidate.artifacts.matted}.png`)),
    readFile(resolve(mattingCasRoot, `${source.candidate.artifacts.normalized}.png`)),
  ]);
  const rawBytes = new Uint8Array(rawBuffer);
  const mattedBytes = new Uint8Array(mattedBuffer);
  const normalizedBytes = new Uint8Array(normalizedBuffer);
  const expectedHashes = [
    source.sourceRawContentHash,
    source.candidate.artifacts.matted,
    source.candidate.artifacts.normalized,
  ];
  const actualHashes = await Promise.all([
    sha256Bytes(rawBytes), sha256Bytes(mattedBytes), sha256Bytes(normalizedBytes),
  ]);
  if (actualHashes.some((hash, index) => hash !== expectedHashes[index])) {
    throw new Error(`ANCHOR_CALIBRATION_CAS_HASH_MISMATCH:${source.frameIndex}`);
  }
  const rawDecoded = inspectPng(rawBytes);
  const mattedDecoded = decodeRgbaPng8(mattedBytes);
  const normalizedDecoded = decodeRgbaPng8(normalizedBytes);
  const inputContentHash = source.candidate.artifacts.normalized;
  const [baselineOutput, candidateOutput] = await Promise.all([
    baselineDetector.process({bytes: normalizedBytes, inputContentHash, spec: baselineSpec}),
    candidateDetector.process({bytes: normalizedBytes, inputContentHash, spec: candidateSpec}),
  ]);
  if (baselineOutput.anchors === undefined || candidateOutput.anchors === undefined) {
    throw new Error(`ANCHOR_CALIBRATION_ANCHORS_MISSING:${source.frameIndex}`);
  }
  const stored = await candidateCas.putPng(candidateOutput.bytes);
  const candidateAnchoredHash = stored.contentHash;

  const frameKey = await canonicalHash('pose-clip-anchor-calibration-frame-v1', {
    frameIndex: source.frameIndex,
    frozenFrameExecutionKey: source.frozenFrameExecutionKey,
    mattingCalibrationResultHash: recordedMattingResultHash,
    candidateAnchorSpecHash: candidateSpec.processorSpecHash,
  });
  const raw = await artifact('raw', frameKey, visualAsset(
    `rabbit.anchor-calibration.${source.frameIndex}.raw`,
    source.sourceRawContentHash,
    rawDecoded.width,
    rawDecoded.height,
    'opaque',
  ));
  const matted = await artifact('matted', raw.outputHash, visualAsset(
    `rabbit.anchor-calibration.${source.frameIndex}.matted`,
    source.candidate.artifacts.matted,
    mattedDecoded.width,
    mattedDecoded.height,
    'straight',
  ));
  const normalized = await artifact('normalized', matted.outputHash, visualAsset(
    `rabbit.anchor-calibration.${source.frameIndex}.normalized`,
    source.candidate.artifacts.normalized,
    normalizedDecoded.width,
    normalizedDecoded.height,
    'straight',
  ));
  const anchoredAsset = visualAsset(
    `rabbit.anchor-calibration.${source.frameIndex}`,
    candidateAnchoredHash,
    normalizedDecoded.width,
    normalizedDecoded.height,
    'straight',
  );
  const anchored = await artifact('anchored', normalized.outputHash, anchoredAsset);
  const hasBilateral = candidateOutput.anchors.leftFoot !== undefined
    && candidateOutput.anchors.rightFoot !== undefined;
  const framePayload = {
    schemaVersion: '1.0.0' as const,
    frameExecutionKey: frameKey,
    frameJobHash: await canonicalHash('pose-clip-anchor-calibration-job-v1', {
      frameIndex: source.frameIndex,
      frozenFrameExecutionKey: source.frozenFrameExecutionKey,
    }),
    frameIndex: source.frameIndex,
    frameSpecHash: await canonicalHash('pose-clip-anchor-calibration-spec-v1', {frameIndex: source.frameIndex}),
    generationInputHash: frameKey,
    artifacts: [raw, matted, normalized, anchored],
    poseFrame: {
      assetId: anchoredAsset.id,
      durationFrames: 3,
      anchors: candidateOutput.anchors,
      contact: {type: 'both' as const},
      referenceFoot: 'midpoint' as const,
    },
    qa: {
      structural: 'passed' as const,
      matting: 'passed' as const,
      normalization: 'passed' as const,
      anchors: hasBilateral ? 'passed' as const : 'failed' as const,
      productionReady: hasBilateral,
      diagnostics: hasBilateral ? [] : [{
        code: 'FRAME_REQUIRED_ANCHOR_MISSING',
        severity: 'error' as const,
        message: 'Bilateral foot anchors are required by calibration',
        frameIndex: source.frameIndex,
        stage: 'anchored',
      }],
    },
  };
  continuityFrameResults.push({
    ...framePayload,
    resultHash: await hashPoseClipFrameProductionResultPayload(framePayload),
  });
  frames.push({
    frameIndex: source.frameIndex,
    frozenFrameExecutionKey: source.frozenFrameExecutionKey,
    sourceNormalizedContentHash: source.candidate.artifacts.normalized,
    candidateAnchoredContentHash: candidateAnchoredHash,
    baselineAnchors: baselineOutput.anchors,
    candidateAnchors: candidateOutput.anchors,
    checks: {
      normalizedCasVerified: actualHashes[2] === source.candidate.artifacts.normalized,
      anchoredBytesImmutable: candidateAnchoredHash === source.candidate.artifacts.normalized,
      globalFootUnchanged: candidateOutput.anchors.foot.x === baselineOutput.anchors.foot.x
        && candidateOutput.anchors.foot.y === baselineOutput.anchors.foot.y,
      bilateralFootAnchorsPresent: hasBilateral,
      anchorsWithinNormalizedCanvas: allAnchorsInUnitInterval(candidateOutput.anchors),
    },
  });
}

const continuity = await continuityEvaluator.evaluate({
  frameResults: continuityFrameResults,
  loop: true,
  spec: continuityQaSpec,
});
const automatedChecks = {
  allNormalizedCasVerified: frames.every(({checks}) => checks.normalizedCasVerified),
  allAnchoredBytesImmutable: frames.every(({checks}) => checks.anchoredBytesImmutable),
  allGlobalFootAnchorsUnchanged: frames.every(({checks}) => checks.globalFootUnchanged),
  allBilateralFootAnchorsPresent: frames.every(({checks}) => checks.bilateralFootAnchorsPresent),
  allAnchorsWithinNormalizedCanvas: frames.every(({checks}) => checks.anchorsWithinNormalizedCanvas),
  allContinuityFrameQaPassed: continuityFrameResults.every(({qa}) => qa.productionReady),
};
const payload = {
  schemaVersion: '1.0.0' as const,
  gate: 'M4 Commit 8.3 — Bilateral Foot Anchor Calibration',
  status: 'CANDIDATE_MEASURED' as const,
  source: {
    frozenPoseClipHash: manifest.production.poseClipHash,
    frozenProductionResultHash: manifest.production.resultHash,
    mattingCalibrationResultHash: recordedMattingResultHash,
  },
  specs: {
    candidateMattingSpecHash: mattingReport.specs.candidateMattingSpecHash,
    normalizationProcessorSpecHash: mattingReport.specs.normalizationProcessorSpecHash,
    baselineAnchorSpecHash: baselineSpec.processorSpecHash,
    candidateAnchorSpecHash: candidateSpec.processorSpecHash,
    continuityFeatureSpecHash: continuityFeatureSpec.extractorSpecHash,
    continuityQaSpecHash: continuityQaSpec.continuityQaSpecHash,
  },
  automatedChecks,
  automatedChecksPassed: Object.values(automatedChecks).every(Boolean),
  downstreamContinuityDiagnostics: {
    thresholdPolicy: 'collection-only-not-calibrated' as const,
    status: continuity.continuity,
    automatedReady: continuity.automatedReady,
    metrics: continuity.metrics,
    diagnostics: continuity.diagnostics,
    evaluationHash: continuity.evaluationHash,
  },
  visualApproval: 'pending' as const,
  frames,
};
const report = {
  ...payload,
  calibrationResultHash: await canonicalHash('pose-clip-anchor-calibration-result-v1', payload),
};
await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
