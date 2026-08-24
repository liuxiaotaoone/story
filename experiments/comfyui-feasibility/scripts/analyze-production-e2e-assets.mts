import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CanonicalCanvasPoseFrameNormalizer,
  decodeRgbaPng8,
} from '@pose-clip/asset-generation';
import {canonicalHash, createPoseFrameProcessorSpec} from '@pose-clip/schemas';
import {measureRgbaQuality} from '../src/production-e2e-report.ts';
import {
  QUALITY_ANALYSIS_STAGES,
  QualityAnalysisIntegrityError,
  assertFrozenQualityAnalysisSource,
  assertQualityAnalysisSpec,
  bindQualityAnalysisResult,
  qualityAnalysisSpecHash,
  verifyQualityAnalysisCasBytes,
  type FrozenProductionE2eManifest,
  type QualityAnalysisSourceReport,
  type QualityAnalysisSpec,
  type QualityAnalysisStage,
} from '../src/production-quality-analysis.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = process.env.M4_E2E_REPORT_PATH ?? resolve(root, 'reports', 'production-e2e.json');
const manifestPath = process.env.M4_E2E_PASS_MANIFEST_PATH
  ?? resolve(root, 'frozen', 'production-e2e-pass-manifest.json');
const specPath = process.env.M4_QUALITY_ANALYSIS_SPEC_PATH
  ?? resolve(root, 'frozen', 'rgba-quality-baseline-spec.json');
const outputPath = process.env.M4_QUALITY_REPORT_PATH
  ?? resolve(root, 'reports', 'production-quality-analysis.json');
const casRoot = process.env.M4_E2E_CAS_ROOT ?? resolve(root, 'generated', 'production-e2e', 'cas');

async function main(): Promise<void> {
  const [reportBytes, manifestBytes, specBytes] = await Promise.all([
    readFile(reportPath),
    readFile(manifestPath),
    readFile(specPath),
  ]);
  const report = JSON.parse(new TextDecoder().decode(reportBytes)) as QualityAnalysisSourceReport;
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as FrozenProductionE2eManifest;
  const spec = JSON.parse(new TextDecoder().decode(specBytes)) as QualityAnalysisSpec;
  assertQualityAnalysisSpec(spec);
  assertFrozenQualityAnalysisSource(manifest, report);

  const normalizationSpec = await createPoseFrameProcessorSpec({
    schemaVersion: spec.schemaVersion,
    stage: 'normalized',
    processor: spec.normalization.processor,
    config: spec.normalization.config,
  });
  const specHash = await qualityAnalysisSpecHash(spec);
  const normalizer = new CanonicalCanvasPoseFrameNormalizer();
  const frames = [];
  for (const frame of report.frames!) {
    const byStage = new Map(frame.artifacts.map(artifact => [artifact.stage, artifact]));
    const decoded = new Map<
      Exclude<QualityAnalysisStage, 'raw'>,
      ReturnType<typeof decodeRgbaPng8>
    >();
    const bytes = new Map<QualityAnalysisStage, Uint8Array>();
    const verifiedArtifacts = {} as Record<QualityAnalysisStage, {contentHash: string; verified: true}>;
    for (const stage of QUALITY_ANALYSIS_STAGES) {
      const artifact = byStage.get(stage);
      if (artifact === undefined) throw new QualityAnalysisIntegrityError(
        'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH',
        `Frame ${frame.frameIndex} lacks ${stage} artifact after frozen binding`,
        {frameIndex: frame.frameIndex, stage},
      );
      const stageBytes = new Uint8Array(await readFile(resolve(casRoot, `${artifact.contentHash}.png`)));
      await verifyQualityAnalysisCasBytes(stageBytes, artifact.contentHash, frame.frameIndex, stage);
      bytes.set(stage, stageBytes);
      verifiedArtifacts[stage] = {contentHash: artifact.contentHash, verified: true};
      if (stage !== 'raw') decoded.set(stage, decodeRgbaPng8(stageBytes));
    }

    const matted = byStage.get('matted')!;
    const transform = await normalizer.plan({
      bytes: bytes.get('matted')!,
      inputContentHash: matted.contentHash,
      spec: normalizationSpec,
    });
    const rgba = spec.rgba;
    frames.push({
      frameIndex: frame.frameIndex,
      frameExecutionKey: frame.frameExecutionKey,
      artifacts: verifiedArtifacts,
      normalizationTransform: transform,
      stageQuality: Object.fromEntries(
        [...decoded.entries()].map(([stage, image]) => [stage, measureRgbaQuality(
          image,
          rgba.alphaThreshold,
          rgba.opaqueThreshold,
          rgba.green.minimum,
          rgba.green.dominance,
        )]),
      ),
    });
  }

  const result = await bindQualityAnalysisResult({
    schemaVersion: '1.0.0' as const,
    gate: 'M4 Commit 8.1 — Quality Evidence Closure',
    status: 'PASS' as const,
    source: {
      frozenPassManifestHash: await canonicalHash('m4-commit-7-pass-manifest-v1', manifest),
      sourceReportBindingHash: await canonicalHash('m4-commit-7-quality-source-binding-v1', {
        plan: report.plan,
        production: report.production,
        frames: report.frames,
      }),
      poseClipHash: manifest.production.poseClipHash,
      productionResultHash: manifest.production.resultHash,
    },
    qualityAnalysisSpec: {
      id: spec.id,
      version: spec.version,
      qualityAnalysisSpecHash: specHash,
      normalizationProcessorSpecHash: normalizationSpec.processorSpecHash,
    },
    frames,
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  await mkdir(dirname(outputPath), {recursive: true});
  await writeFile(outputPath, json, 'utf8');
  console.log(json.trimEnd());
}

try {
  await main();
} catch (error) {
  if (error instanceof QualityAnalysisIntegrityError) {
    console.error(JSON.stringify({
      status: 'FAIL',
      error: {
        code: error.code,
        message: error.message,
        ...(error.frameIndex === undefined ? {} : {frameIndex: error.frameIndex}),
        ...(error.stage === undefined ? {} : {stage: error.stage}),
        ...(error.expected === undefined ? {} : {expected: error.expected}),
        ...(error.actual === undefined ? {} : {actual: error.actual}),
      },
    }, null, 2));
    process.exitCode = 1;
  } else {
    throw error;
  }
}
