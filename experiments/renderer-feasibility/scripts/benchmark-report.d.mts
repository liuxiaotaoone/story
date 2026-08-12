export interface BenchmarkReport {
  pixiSubmit?: Record<string, unknown>;
  pixiRender?: Record<string, unknown>;
  browserPngExport?: Record<string, unknown>;
  pngExport?: {
    encode?: Record<string, unknown>;
    write?: Record<string, unknown>;
    [key: string]: unknown;
  };
  frameWrite?: Record<string, unknown>;
  ffmpeg: {encodeMs: number | null};
  total: {
    framePipelineElapsedMs?: number;
    pipelineElapsedMs?: number;
    elapsedMs: number;
  };
  [key: string]: unknown;
}

export function normalizeBenchmarkReport(report: BenchmarkReport, encodeMs: number): BenchmarkReport;
