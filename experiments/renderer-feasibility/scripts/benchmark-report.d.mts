export interface BenchmarkReport {
  pixiSubmit: Record<string, unknown>;
  browserPngExport: Record<string, unknown>;
  frameWrite: Record<string, unknown>;
  ffmpeg: {encodeMs: number | null};
  total: {
    framePipelineElapsedMs: number;
    elapsedMs: number;
  };
  [key: string]: unknown;
}

export function normalizeBenchmarkReport(report: BenchmarkReport, encodeMs: number): BenchmarkReport;
