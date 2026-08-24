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

export interface RgbaQualityMeasurementInput {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface RgbaQualityMeasurement {
  readonly alphaThreshold: number;
  readonly opaqueThreshold: number;
  readonly foregroundCoverage: number;
  readonly meanAlpha: number;
  readonly softEdgeRatio: number;
  readonly visibleGreenSpillRatio: number;
  readonly edgeGreenSpillRatio: number;
  readonly opaqueGreenResidualRatio: number;
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

export function measureRgbaQuality(
  input: RgbaQualityMeasurementInput,
  alphaThreshold = 8,
  opaqueThreshold = 247,
): RgbaQualityMeasurement {
  const pixelCount = input.width * input.height;
  if (pixelCount <= 0 || input.pixels.length !== pixelCount * 4) {
    throw new TypeError('RGBA quality input dimensions do not match pixel bytes');
  }
  if (
    !Number.isInteger(alphaThreshold)
    || !Number.isInteger(opaqueThreshold)
    || alphaThreshold < 1
    || opaqueThreshold > 255
    || alphaThreshold >= opaqueThreshold
  ) throw new TypeError('RGBA quality alpha thresholds are invalid');

  let alphaTotal = 0;
  let visiblePixels = 0;
  let softEdgePixels = 0;
  let visibleGreenPixels = 0;
  let edgeGreenPixels = 0;
  let opaqueGreenPixels = 0;
  for (let offset = 0; offset < input.pixels.length; offset += 4) {
    const red = input.pixels[offset]!;
    const green = input.pixels[offset + 1]!;
    const blue = input.pixels[offset + 2]!;
    const alpha = input.pixels[offset + 3]!;
    alphaTotal += alpha;
    if (alpha < alphaThreshold) continue;
    visiblePixels += 1;
    const softEdge = alpha < opaqueThreshold;
    if (softEdge) softEdgePixels += 1;
    const greenDominant = green >= 64 && green - Math.max(red, blue) >= 24;
    if (!greenDominant) continue;
    visibleGreenPixels += 1;
    if (softEdge) edgeGreenPixels += 1;
    else opaqueGreenPixels += 1;
  }

  return {
    alphaThreshold,
    opaqueThreshold,
    foregroundCoverage: visiblePixels / pixelCount,
    meanAlpha: alphaTotal / (pixelCount * 255),
    softEdgeRatio: visiblePixels === 0 ? 0 : softEdgePixels / visiblePixels,
    visibleGreenSpillRatio: visiblePixels === 0 ? 0 : visibleGreenPixels / visiblePixels,
    edgeGreenSpillRatio: softEdgePixels === 0 ? 0 : edgeGreenPixels / softEdgePixels,
    opaqueGreenResidualRatio: visiblePixels === 0 ? 0 : opaqueGreenPixels / visiblePixels,
  };
}
