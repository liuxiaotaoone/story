import type {CompileDiagnostic} from '@pose-clip/schemas';

// Internal Final Compiler representation. It is intentionally not a Schema,
// persistence format, hash domain, or Renderer contract.
export interface SolvedNarrationTiming {
  segmentId: string;
  ttsRequestId: string;
  audioAssetId: string;
  startFrame: number;
  endFrame: number;
}

export interface SolvedActionTiming {
  expandedActionId: string;
  startFrame: number;
  endFrame: number;
}

export interface SolvedShotTiming {
  shotId: string;
  startFrame: number;
  endFrame: number;
  narration: SolvedNarrationTiming[];
  actions: SolvedActionTiming[];
}

export interface SolvedTimingPlan {
  fps: number;
  durationFrames: number;
  shots: SolvedShotTiming[];
  diagnostics: CompileDiagnostic[];
}

export interface DurationSolveFailure {
  ok: false;
  diagnostics: CompileDiagnostic[];
}

export interface DurationSolveSuccess {
  ok: true;
  timing: SolvedTimingPlan;
}

export type DurationSolveResult = DurationSolveSuccess | DurationSolveFailure;
