import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export function createVisualReview({status, artifactSha256, reviewer, notes = '', reviewedAt = new Date().toISOString()}) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Visual review status must be approved or rejected');
  if (typeof artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifactSha256)) throw new Error('Visual review requires a lowercase SHA-256 artifact hash');
  if (typeof reviewer !== 'string' || reviewer.trim().length === 0) throw new Error('Visual review requires a reviewer');
  return {status, artifactSha256, reviewer: reviewer.trim(), notes: String(notes).trim(), reviewedAt};
}

export function assertCandidateCanBeReviewed(report, manifest, actualArtifactSha256) {
  if (report.status !== 'TECHNICAL_PASS_VISUAL_REVIEW_REQUIRED') throw new Error(`Candidate technical status is not reviewable: ${report.status}`);
  if (manifest.status !== 'candidate') throw new Error(`Artifact manifest is not a candidate: ${manifest.status}`);
  if (report.mp4Sha256 !== actualArtifactSha256 || manifest.artifactSha256 !== actualArtifactSha256) {
    throw new Error('Candidate artifact SHA-256 does not match its technical report and manifest');
  }
}
