import {describe, expect, it} from 'vitest';
import {assertCandidateCanBeReviewed, createVisualReview} from '../src/visual-review.mjs';

const hash = 'a'.repeat(64);

describe('M2.1 visual review promotion', () => {
  it('records an explicit human decision bound to the artifact hash', () => {
    expect(createVisualReview({status: 'approved', artifactSha256: hash, reviewer: 'reviewer', reviewedAt: '2026-08-13T00:00:00.000Z'})).toEqual({
      status: 'approved', artifactSha256: hash, reviewer: 'reviewer', notes: '', reviewedAt: '2026-08-13T00:00:00.000Z',
    });
  });

  it('refuses review when the technical gate or artifact hash does not match', () => {
    expect(() => assertCandidateCanBeReviewed(
      {status: 'TECHNICAL_PASS_VISUAL_REVIEW_REQUIRED', mp4Sha256: hash},
      {status: 'candidate', artifactSha256: hash}, hash,
    )).not.toThrow();
    expect(() => assertCandidateCanBeReviewed(
      {status: 'FAIL', mp4Sha256: hash}, {status: 'candidate', artifactSha256: hash}, hash,
    )).toThrow(/not reviewable/);
    expect(() => assertCandidateCanBeReviewed(
      {status: 'TECHNICAL_PASS_VISUAL_REVIEW_REQUIRED', mp4Sha256: hash},
      {status: 'candidate', artifactSha256: 'b'.repeat(64)}, hash,
    )).toThrow(/does not match/);
  });
});
