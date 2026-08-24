export interface E2eEnvironmentEvidence<RuntimeModel = unknown> {
  readonly endpoint: string;
  readonly runtimeModels: readonly RuntimeModel[];
  readonly systemStats?: unknown;
}

export interface E2eFailureContext {
  readonly phase: 'environment' | 'raw-generation' | 'unknown';
  readonly frameIndex?: number;
  readonly provider?: string;
  readonly promptId?: string;
}

export interface E2eFailureEvidence extends E2eFailureContext {
  readonly name: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly reason?: string;
}

export function createE2eEnvironmentEvidence<RuntimeModel>(
  endpoint: string,
  runtimeModels: readonly RuntimeModel[],
  systemStatsSnapshot: unknown,
): E2eEnvironmentEvidence<RuntimeModel> {
  return {
    endpoint,
    runtimeModels,
    ...(systemStatsSnapshot === undefined ? {} : {systemStats: systemStatsSnapshot}),
  };
}

export function createE2eFailureEvidence(
  error: unknown,
  context: E2eFailureContext,
): E2eFailureEvidence {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const promptFailure = /^ComfyUI prompt (\S+) failed(?: at node ([^:]+))?(?:: (.*))?$/u.exec(message);
  const providerReason = promptFailure?.[3];
  const stableReason = providerReason === undefined
    ? undefined
    : /\b(?:UR_RESULT_ERROR_[A-Z_]+|OUT_OF_DEVICE_MEMORY|DEVICE_LOST)\b/u.exec(providerReason)?.[0];

  return {
    phase: promptFailure === null ? context.phase : 'raw-generation',
    ...(context.frameIndex === undefined ? {} : {frameIndex: context.frameIndex}),
    ...(context.provider === undefined && promptFailure === null
      ? {}
      : {provider: context.provider ?? 'comfyui'}),
    ...(promptFailure?.[1] === undefined && context.promptId === undefined
      ? {}
      : {promptId: promptFailure?.[1] ?? context.promptId}),
    ...(promptFailure?.[2] === undefined ? {} : {nodeId: promptFailure[2]}),
    ...(stableReason === undefined ? {} : {reason: stableReason}),
    name,
    message,
  };
}
