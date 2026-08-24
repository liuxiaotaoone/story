import {canonicalHash, sha256Bytes} from '@pose-clip/schemas';

export const QUALITY_ANALYSIS_STAGES = ['raw', 'matted', 'normalized', 'anchored'] as const;
export type QualityAnalysisStage = typeof QUALITY_ANALYSIS_STAGES[number];

export interface QualityAnalysisSpec {
  readonly schemaVersion: '1.0.0';
  readonly id: string;
  readonly version: string;
  readonly normalization: {
    readonly processor: {readonly name: string; readonly version: string};
    readonly config: {
      readonly canvasWidth: number;
      readonly canvasHeight: number;
      readonly targetForegroundHeight: number;
      readonly maxForegroundWidth: number;
      readonly bottomPadding: number;
      readonly alphaThreshold: number;
      readonly resampling: 'bilinear-premultiplied';
    };
  };
  readonly rgba: {
    readonly alphaThreshold: number;
    readonly opaqueThreshold: number;
    readonly green: {readonly minimum: number; readonly dominance: number};
  };
}

export interface QualityAnalysisArtifactRecord {
  readonly stage: QualityAnalysisStage;
  readonly contentHash: string;
}

export interface QualityAnalysisReportFrame {
  readonly frameIndex: number;
  readonly frameExecutionKey: string;
  readonly artifacts: readonly QualityAnalysisArtifactRecord[];
}

export interface QualityAnalysisSourceReport {
  readonly status: string;
  readonly plan?: {
    readonly workflow: {readonly id: string; readonly contentHash: string};
    readonly modelCatalogHash: string;
    readonly referenceAsset: {readonly contentHash: string};
    readonly productionRequestHash: string;
    readonly trustedProfileHash: string;
    readonly frameExecutionKeys: readonly string[];
  };
  readonly production?: {readonly poseClipHash?: string; readonly resultHash?: string};
  readonly frames?: readonly QualityAnalysisReportFrame[];
}

export interface FrozenProductionE2eManifest {
  readonly status: string;
  readonly admission: {
    readonly workflowId: string;
    readonly workflowHash: string;
    readonly modelCatalogHash: string;
    readonly referenceAssetHash: string;
    readonly productionRequestHash: string;
    readonly trustedProfileHash: string;
  };
  readonly frames: ReadonlyArray<{
    readonly frameIndex: number;
    readonly frameExecutionKey: string;
    readonly artifacts: Readonly<Record<QualityAnalysisStage, string>>;
  }>;
  readonly production: {readonly poseClipHash: string; readonly resultHash: string};
}

export type QualityAnalysisIntegrityErrorCode =
  | 'QUALITY_ANALYSIS_INVALID_SPEC'
  | 'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH'
  | 'QUALITY_ANALYSIS_CAS_HASH_MISMATCH';

export class QualityAnalysisIntegrityError extends Error {
  readonly code: QualityAnalysisIntegrityErrorCode;
  readonly frameIndex: number | undefined;
  readonly stage: QualityAnalysisStage | undefined;
  readonly expected: string | undefined;
  readonly actual: string | undefined;

  constructor(
    code: QualityAnalysisIntegrityErrorCode,
    message: string,
    evidence: {
      readonly frameIndex?: number;
      readonly stage?: QualityAnalysisStage;
      readonly expected?: string;
      readonly actual?: string;
    } = {},
  ) {
    super(message);
    this.name = 'QualityAnalysisIntegrityError';
    this.code = code;
    this.frameIndex = evidence.frameIndex;
    this.stage = evidence.stage;
    this.expected = evidence.expected;
    this.actual = evidence.actual;
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new QualityAnalysisIntegrityError(
    'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH',
    `${label} does not match the frozen M4 Commit 7 PASS manifest`,
    {expected: String(expected), actual: String(actual)},
  );
}

function stageMap(
  frameIndex: number,
  artifacts: readonly QualityAnalysisArtifactRecord[],
): ReadonlyMap<QualityAnalysisStage, QualityAnalysisArtifactRecord> {
  const result = new Map<QualityAnalysisStage, QualityAnalysisArtifactRecord>();
  for (const artifact of artifacts) {
    if (!QUALITY_ANALYSIS_STAGES.includes(artifact.stage) || result.has(artifact.stage)) {
      throw new QualityAnalysisIntegrityError(
        'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH',
        `Frame ${frameIndex} has an invalid or duplicate ${artifact.stage} artifact`,
        {frameIndex, stage: artifact.stage},
      );
    }
    result.set(artifact.stage, artifact);
  }
  if (result.size !== QUALITY_ANALYSIS_STAGES.length) throw new QualityAnalysisIntegrityError(
    'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH',
    `Frame ${frameIndex} does not contain exactly four production stages`,
    {frameIndex},
  );
  return result;
}

export function assertFrozenQualityAnalysisSource(
  manifest: FrozenProductionE2eManifest,
  report: QualityAnalysisSourceReport,
): void {
  assertEqual('Manifest status', manifest.status, 'PASS');
  assertEqual('Report status', report.status, 'PASS');
  if (report.plan === undefined || report.production === undefined || report.frames === undefined) {
    throw new QualityAnalysisIntegrityError(
      'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH',
      'PASS report lacks plan, production, or frame evidence',
    );
  }

  assertEqual('Workflow id', report.plan.workflow.id, manifest.admission.workflowId);
  assertEqual('Workflow hash', report.plan.workflow.contentHash, manifest.admission.workflowHash);
  assertEqual('Model catalog hash', report.plan.modelCatalogHash, manifest.admission.modelCatalogHash);
  assertEqual('Reference asset hash', report.plan.referenceAsset.contentHash, manifest.admission.referenceAssetHash);
  assertEqual('Production request hash', report.plan.productionRequestHash, manifest.admission.productionRequestHash);
  assertEqual('Trusted profile hash', report.plan.trustedProfileHash, manifest.admission.trustedProfileHash);
  assertEqual('PoseClip hash', report.production.poseClipHash, manifest.production.poseClipHash);
  assertEqual('Production result hash', report.production.resultHash, manifest.production.resultHash);
  assertEqual('Frame count', report.frames.length, manifest.frames.length);
  assertEqual('Plan frame key count', report.plan.frameExecutionKeys.length, manifest.frames.length);

  for (const [offset, frozenFrame] of manifest.frames.entries()) {
    const reportFrame = report.frames[offset];
    if (reportFrame === undefined) throw new QualityAnalysisIntegrityError(
      'QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH',
      `Frozen frame ${frozenFrame.frameIndex} is absent from PASS report`,
      {frameIndex: frozenFrame.frameIndex},
    );
    assertEqual(`Frame index ${offset}`, reportFrame.frameIndex, frozenFrame.frameIndex);
    assertEqual(`Plan frame execution key ${offset}`, report.plan.frameExecutionKeys[offset], frozenFrame.frameExecutionKey);
    assertEqual(`Frame execution key ${offset}`, reportFrame.frameExecutionKey, frozenFrame.frameExecutionKey);
    const artifacts = stageMap(reportFrame.frameIndex, reportFrame.artifacts);
    for (const stage of QUALITY_ANALYSIS_STAGES) {
      assertEqual(
        `Frame ${reportFrame.frameIndex} ${stage} content hash`,
        artifacts.get(stage)?.contentHash,
        frozenFrame.artifacts[stage],
      );
    }
  }
}

export function assertQualityAnalysisSpec(spec: QualityAnalysisSpec): void {
  const rgba = spec.rgba;
  const integers = [
    rgba.alphaThreshold,
    rgba.opaqueThreshold,
    rgba.green.minimum,
    rgba.green.dominance,
  ];
  if (
    spec.schemaVersion !== '1.0.0'
    || spec.id.trim().length === 0
    || spec.version.trim().length === 0
    || integers.some(value => !Number.isInteger(value))
    || rgba.alphaThreshold < 1
    || rgba.alphaThreshold >= rgba.opaqueThreshold
    || rgba.opaqueThreshold > 255
    || rgba.green.minimum < 0
    || rgba.green.minimum > 255
    || rgba.green.dominance < 0
    || rgba.green.dominance > 255
  ) throw new QualityAnalysisIntegrityError(
    'QUALITY_ANALYSIS_INVALID_SPEC',
    'Quality analysis spec is invalid',
  );
}

export async function qualityAnalysisSpecHash(spec: QualityAnalysisSpec): Promise<string> {
  assertQualityAnalysisSpec(spec);
  return canonicalHash('pose-clip-quality-analysis-spec-v1', spec);
}

export async function verifyQualityAnalysisCasBytes(
  bytes: Uint8Array,
  expectedHash: string,
  frameIndex: number,
  stage: QualityAnalysisStage,
): Promise<string> {
  const actualHash = await sha256Bytes(bytes);
  if (actualHash !== expectedHash) throw new QualityAnalysisIntegrityError(
    'QUALITY_ANALYSIS_CAS_HASH_MISMATCH',
    `Frame ${frameIndex} ${stage} CAS bytes do not match artifact contentHash`,
    {frameIndex, stage, expected: expectedHash, actual: actualHash},
  );
  return actualHash;
}

export async function bindQualityAnalysisResult<T extends object>(
  result: T,
): Promise<T & {readonly analysisResultHash: string}> {
  if ('analysisResultHash' in result) throw new TypeError('Quality analysis result is already bound');
  return {
    ...result,
    analysisResultHash: await canonicalHash('pose-clip-quality-analysis-result-v1', result),
  };
}
