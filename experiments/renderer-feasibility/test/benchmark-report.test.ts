import {describe, expect, it} from 'vitest';
import {normalizeBenchmarkReport} from '../scripts/benchmark-report.mjs';

describe('benchmark report timing contract', () => {
  it('keeps Frame Pipeline and FFmpeg disjoint, then adds them exactly once', () => {
    const report = normalizeBenchmarkReport({
      pixiSubmit: {averageMsPerFrame: 0.3},
      browserPngExport: {averageMsPerFrame: 12},
      frameWrite: {averageMsPerFrame: 14},
      ffmpeg: {encodeMs: null},
      total: {framePipelineElapsedMs: 14_575, elapsedMs: 14_575},
    }, 761);
    expect(report.total).toEqual({framePipelineElapsedMs: 14_575, elapsedMs: 15_336});
  });

  it('migrates the old ambiguous field names without changing measured durations', () => {
    const report = normalizeBenchmarkReport({
      pixiRender: {averageMsPerFrame: 0.3},
      pngExport: {
        encode: {averageMsPerFrame: 12},
        write: {averageMsPerFrame: 14},
      },
      ffmpeg: {encodeMs: null},
      total: {pipelineElapsedMs: 14_575, elapsedMs: 14_575},
    }, 761);
    expect(report.pixiRender).toBeUndefined();
    expect(report.pngExport).toBeUndefined();
    expect(report.pixiSubmit?.averageMsPerFrame).toBe(0.3);
    expect(report.browserPngExport?.averageMsPerFrame).toBe(12);
    expect(report.frameWrite?.averageMsPerFrame).toBe(14);
    expect(report.total).toEqual({framePipelineElapsedMs: 14_575, elapsedMs: 15_336});
  });
});
