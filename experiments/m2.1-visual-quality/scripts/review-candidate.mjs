import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {assertCandidateCanBeReviewed, createVisualReview, sha256File} from '../src/visual-review.mjs';

const root = resolve(import.meta.dirname, '..');
const candidate = join(root, 'candidate');
const frozen = join(root, 'frozen');
const args = process.argv.slice(2);
const decision = args.includes('--approve') ? 'approved' : args.includes('--reject') ? 'rejected' : null;
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
if (decision === null || (args.includes('--approve') && args.includes('--reject'))) {
  throw new Error('Use exactly one of --approve or --reject');
}
const reviewer = valueAfter('--reviewer');
if (!reviewer) throw new Error('--reviewer is required');
const notes = valueAfter('--notes') ?? '';
const artifact = join(candidate, 'm21-visual-acceptance.mp4');
const report = JSON.parse(await readFile(join(candidate, 'technical-gate-report.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(candidate, 'artifact-manifest.json'), 'utf8'));
const artifactSha256 = await sha256File(artifact);
assertCandidateCanBeReviewed(report, manifest, artifactSha256);
const review = createVisualReview({status: decision, artifactSha256, reviewer, notes});
await writeFile(join(candidate, 'visual-review.json'), `${JSON.stringify(review, null, 2)}\n`);

if (decision === 'approved') {
  await mkdir(frozen, {recursive: true});
  for (const filename of ['m21-visual-acceptance.mp4', 'render-plan.golden.json', 'director-plan.golden.json', 'preflight.golden.json', 'subtitles.ass', 'technical-gate-report.json', 'artifact-manifest.json', 'visual-review.json']) {
    await copyFile(join(candidate, filename), join(frozen, filename));
  }
  await writeFile(join(frozen, 'FROZEN'), `M2.1 Visual Acceptance PASS / Frozen\n${review.reviewedAt}\n${artifactSha256}\n`);
  process.stdout.write(`M2.1 Visual Acceptance approved and frozen: ${frozen}\n`);
} else {
  process.stdout.write(`M2.1 candidate rejected; frozen artifacts unchanged: ${candidate}\n`);
}
