export interface BenchmarkArguments {
  mode: 'swiftshader' | 'gpu';
  skipFfmpeg: boolean;
  externalFfmpegMs: number | null;
}

export function parseBenchmarkArgs(argumentsList: string[]): BenchmarkArguments;
