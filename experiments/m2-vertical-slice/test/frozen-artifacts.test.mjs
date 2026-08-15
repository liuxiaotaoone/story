import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  PreflightCompileResultSchema,
  RenderPlanSchema,
  semanticRenderPlanHashV1,
} from '@pose-clip/schemas';
import {describe, expect, it} from 'vitest';

const frozen = resolve(import.meta.dirname, '..', 'frozen');
const json = async name => JSON.parse(await readFile(resolve(frozen, name), 'utf8'));

describe('M2 frozen evidence', () => {
  it('binds golden compiler outputs and the media report to one manifest', async () => {
    const [manifest, report, renderPlanJson, preflightJson] = await Promise.all([
      json('artifact-manifest.json'),
      json('m2-vertical-slice-report.json'),
      json('render-plan.golden.json'),
      json('preflight.golden.json'),
    ]);
    const renderPlan = RenderPlanSchema.parse(renderPlanJson);
    const preflight = PreflightCompileResultSchema.parse(preflightJson);
    expect(await semanticRenderPlanHashV1(renderPlan)).toBe(manifest.renderPlanSemanticHash);
    expect(preflight.preflightHash).toBe(manifest.preflightHash);
    expect(report.status).toBe('PASS');
    expect(report.mp4Sha256).toBe(manifest.mp4Sha256);
    expect(report.mediaProbe).toEqual(expect.objectContaining({
      width: 1280,
      height: 720,
      fps: 30,
      frameCount: 660,
      durationSeconds: 22,
    }));
    expect(report.blankFrames).toBe(0);
    expect(Object.keys(manifest.criticalFrameRgbaSha256)).toHaveLength(7);
  });
});
