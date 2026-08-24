import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CanonicalCanvasPoseFrameNormalizer,
  decodeRgbaPng8,
} from '@pose-clip/asset-generation';
import {createPoseFrameProcessorSpec} from '@pose-clip/schemas';
import {measureRgbaQuality} from '../src/production-e2e-report.ts';

interface ReportArtifact {
  readonly stage: 'raw' | 'matted' | 'normalized' | 'anchored';
  readonly contentHash: string;
}

interface ReportFrame {
  readonly frameIndex: number;
  readonly artifacts: readonly ReportArtifact[];
}

interface ProductionE2eReport {
  readonly status: string;
  readonly production?: {readonly poseClipHash?: string; readonly resultHash?: string};
  readonly frames?: readonly ReportFrame[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = process.env.M4_E2E_REPORT_PATH ?? resolve(root, 'reports', 'production-e2e.json');
const casRoot = resolve(root, 'generated', 'production-e2e', 'cas');
const report = JSON.parse(new TextDecoder().decode(new Uint8Array(await readFile(reportPath)))) as ProductionE2eReport;
if (report.status !== 'PASS' || report.frames?.length !== 4) {
  throw new Error('Production E2E asset analysis requires a four-frame PASS report');
}

const normalizationSpec = await createPoseFrameProcessorSpec({
  schemaVersion: '1.0.0',
  stage: 'normalized',
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
});
const normalizer = new CanonicalCanvasPoseFrameNormalizer();
const frames = [];
for (const frame of report.frames) {
  const byStage = new Map(frame.artifacts.map((artifact) => [artifact.stage, artifact]));
  const decoded = new Map<'matted' | 'normalized' | 'anchored', ReturnType<typeof decodeRgbaPng8>>();
  const bytes = new Map<ReportArtifact['stage'], Uint8Array>();
  for (const stage of ['raw', 'matted', 'normalized', 'anchored'] as const) {
    const artifact = byStage.get(stage);
    if (artifact === undefined) throw new Error(`Frame ${frame.frameIndex} lacks ${stage} artifact`);
    const stageBytes = new Uint8Array(await readFile(resolve(casRoot, `${artifact.contentHash}.png`)));
    bytes.set(stage, stageBytes);
    if (stage !== 'raw') decoded.set(stage, decodeRgbaPng8(stageBytes));
  }
  const matted = byStage.get('matted')!;
  const transform = await normalizer.plan({
    bytes: bytes.get('matted')!,
    inputContentHash: matted.contentHash,
    spec: normalizationSpec,
  });
  frames.push({
    frameIndex: frame.frameIndex,
    normalizationTransform: transform,
    stageQuality: Object.fromEntries(
      [...decoded.entries()].map(([stage, image]) => [stage, measureRgbaQuality(image)]),
    ),
  });
}

console.log(JSON.stringify({
  schemaVersion: '1.0.0',
  source: {
    poseClipHash: report.production?.poseClipHash,
    resultHash: report.production?.resultHash,
  },
  definitions: {
    greenDominant: 'green >= 64 and green - max(red, blue) >= 24',
    foreground: 'alpha >= 8',
    softEdge: '8 <= alpha < 247',
  },
  frames,
}, null, 2));
