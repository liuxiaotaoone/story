import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashPreflightCompileResultPayload} from '@pose-clip/compiler';
import {PreflightCompileResultSchema, RenderPlanSchema, semanticRenderPlanHash} from '@pose-clip/schemas';
import {sha256File} from './visual-review.mjs';

const MANIFEST_NAME = 'artifact-manifest.json';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function evidenceFileHashes(frozenRoot) {
  const filenames = (await readdir(frozenRoot, {withFileTypes: true}))
    .filter(entry => entry.isFile() && entry.name !== MANIFEST_NAME)
    .map(entry => entry.name)
    .sort();
  return Object.fromEntries(await Promise.all(filenames.map(async filename => [filename, await sha256File(join(frozenRoot, filename))])));
}

export async function sealFrozenEvidence(frozenRoot) {
  const manifestPath = join(frozenRoot, MANIFEST_NAME);
  const manifest = await readJson(manifestPath);
  const files = await evidenceFileHashes(frozenRoot);
  const sealed = {
    ...manifest,
    integrity: {
      algorithm: 'sha256',
      manifestSelfExcluded: MANIFEST_NAME,
      files,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(sealed, null, 2)}\n`);
  return sealed;
}

export async function verifyFrozenEvidence(frozenRoot) {
  const manifest = await readJson(join(frozenRoot, MANIFEST_NAME));
  const technicalReport = await readJson(join(frozenRoot, 'technical-gate-report.json'));
  const visualReview = await readJson(join(frozenRoot, 'visual-review.json'));
  const renderPlan = RenderPlanSchema.parse(await readJson(join(frozenRoot, 'render-plan.golden.json')));
  const preflight = PreflightCompileResultSchema.parse(await readJson(join(frozenRoot, 'preflight.golden.json')));
  if (manifest.status !== 'frozen') throw new Error(`Frozen manifest status must be frozen, received ${manifest.status}`);
  if (visualReview.status !== 'approved') throw new Error(`Frozen visual review must be approved, received ${visualReview.status}`);

  const mp4Sha256 = await sha256File(join(frozenRoot, 'm21-visual-acceptance.mp4'));
  const mp4Hashes = [manifest.artifactSha256, technicalReport.mp4Sha256, visualReview.artifactSha256];
  if (mp4Hashes.some(hash => hash !== mp4Sha256)) throw new Error('Frozen MP4 SHA-256 does not match manifest, technical report and visual review');

  const renderPlanSemanticHash = await semanticRenderPlanHash(renderPlan);
  if (renderPlanSemanticHash !== manifest.renderPlanSemanticHash || renderPlanSemanticHash !== technicalReport.renderPlanSemanticHash) {
    throw new Error('Frozen RenderPlan semantic hash does not match manifest and technical report');
  }

  const {preflightHash, ...preflightPayload} = preflight;
  const computedPreflightHash = await hashPreflightCompileResultPayload(preflightPayload);
  if (computedPreflightHash !== preflightHash || computedPreflightHash !== manifest.preflightHash || computedPreflightHash !== technicalReport.preflightHash) {
    throw new Error('Frozen Preflight hash does not match payload, manifest and technical report');
  }

  if (manifest.integrity?.algorithm !== 'sha256' || manifest.integrity?.manifestSelfExcluded !== MANIFEST_NAME) {
    throw new Error('Frozen manifest has no supported evidence-file integrity seal');
  }
  const actualFiles = await evidenceFileHashes(frozenRoot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.integrity.files)) {
    throw new Error('Frozen evidence file SHA-256 map does not match directory contents');
  }
  return {mp4Sha256, renderPlanSemanticHash, preflightHash: computedPreflightHash, files: actualFiles};
}
