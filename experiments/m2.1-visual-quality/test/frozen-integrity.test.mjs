import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {verifyFrozenEvidence} from '../src/frozen-integrity.mjs';

describe('M2.1 frozen evidence integrity', () => {
  it('binds every frozen evidence file plus semantic RenderPlan, Preflight and MP4 hashes', async () => {
    const result = await verifyFrozenEvidence(resolve(import.meta.dirname, '..', 'frozen'));
    expect(result.mp4Sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.renderPlanSemanticHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.preflightHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(result.files)).toEqual([
      'FROZEN',
      'director-plan.golden.json',
      'm21-visual-acceptance.mp4',
      'preflight.golden.json',
      'render-plan.golden.json',
      'subtitles.ass',
      'technical-gate-report.json',
      'visual-review.json',
    ]);
  });
});
