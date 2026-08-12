export function normalizeBenchmarkReport(report, encodeMs) {
  if (!Number.isFinite(encodeMs) || encodeMs < 0) throw new Error(`Invalid encodeMs: ${encodeMs}`);
  const framePipelineElapsedMs = report.total.framePipelineElapsedMs
    ?? report.total.pipelineElapsedMs
    ?? report.total.elapsedMs;
  if (!Number.isFinite(framePipelineElapsedMs) || framePipelineElapsedMs < 0) {
    throw new Error('Benchmark report is missing a valid Frame Pipeline duration');
  }
  if (report.pixiSubmit === undefined && report.pixiRender !== undefined) {
    report.pixiSubmit = report.pixiRender;
    delete report.pixiRender;
  }
  if (report.browserPngExport === undefined && report.pngExport !== undefined) {
    report.browserPngExport = {
      ...(report.pngExport.encode ?? report.pngExport),
      includes: ['gpu-completion-wait', 'framebuffer-readback', 'png-encode', 'base64-encode'],
    };
    if (report.pngExport.write !== undefined) report.frameWrite = report.pngExport.write;
    delete report.pngExport;
  }
  report.ffmpeg.encodeMs = encodeMs;
  report.total = {
    framePipelineElapsedMs,
    elapsedMs: framePipelineElapsedMs + encodeMs,
  };
  return report;
}
