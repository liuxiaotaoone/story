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

  it('rejects legacy reports instead of inferring the Frame Pipeline duration', () => {
    expect(() => normalizeBenchmarkReport({
      pixiSubmit: {averageMsPerFrame: 0.3},
      browserPngExport: {averageMsPerFrame: 12},
      frameWrite: {averageMsPerFrame: 14},
      ffmpeg: {encodeMs: null},
      total: {pipelineElapsedMs: 14_575, elapsedMs: 14_575},
    } as never, 761)).toThrow('rerun the Benchmark');
  });

  it('rejects reports using legacy metric names', () => {
    expect(() => normalizeBenchmarkReport({
      pixiRender: {averageMsPerFrame: 0.3},
      pngExport: {averageMsPerFrame: 26},
      ffmpeg: {encodeMs: null},
      total: {framePipelineElapsedMs: 14_575, elapsedMs: 14_575},
    } as never, 761)).toThrow('current metric fields');
  });
});
