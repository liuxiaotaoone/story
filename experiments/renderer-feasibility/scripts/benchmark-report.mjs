export function normalizeBenchmarkReport(report, encodeMs) {
  if (!Number.isFinite(encodeMs) || encodeMs < 0) throw new Error(`Invalid encodeMs: ${encodeMs}`);
  const framePipelineElapsedMs = report.total?.framePipelineElapsedMs;
  if (!Number.isFinite(framePipelineElapsedMs) || framePipelineElapsedMs < 0) {
    throw new Error('Legacy benchmark report is unsupported; rerun the Benchmark to produce framePipelineElapsedMs');
  }
  if (report.pixiSubmit === undefined || report.browserPngExport === undefined || report.frameWrite === undefined) {
    throw new Error('Legacy benchmark report is unsupported; rerun the Benchmark with current metric fields');
  }
  report.ffmpeg.encodeMs = encodeMs;
  report.total = {
    framePipelineElapsedMs,
    elapsedMs: framePipelineElapsedMs + encodeMs,
  };
  return report;
}
