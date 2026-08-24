import {describe, expect, it} from 'vitest';
import {
  createE2eEnvironmentEvidence,
  createE2eFailureEvidence,
  measureRgbaQuality,
} from '../src/production-e2e-report.js';

describe('production E2E report evidence', () => {
  it('retains a successfully captured system_stats snapshot in later failure evidence', () => {
    const systemStats = {
      devices: [{name: 'xpu:0 Intel Arc 130T', vram_total: 17_648_951_296}],
    };

    expect(createE2eEnvironmentEvidence('http://127.0.0.1:8188', [{verified: true}], systemStats)).toEqual({
      endpoint: 'http://127.0.0.1:8188',
      runtimeModels: [{verified: true}],
      systemStats,
    });
  });

  it('omits systemStats when readiness never produced a snapshot', () => {
    expect(createE2eEnvironmentEvidence('http://127.0.0.1:8188', [], undefined)).toEqual({
      endpoint: 'http://127.0.0.1:8188',
      runtimeModels: [],
    });
  });

  it('extracts structured raw-frame OOM diagnostics without losing the original message', () => {
    const message = 'ComfyUI prompt P3 failed at node 15: level_zero backend failed with error: 39 (UR_RESULT_ERROR_OUT_OF_DEVICE_MEMORY)';

    expect(createE2eFailureEvidence(new Error(message), {
      phase: 'raw-generation',
      frameIndex: 2,
      provider: 'comfyui',
      promptId: 'P3',
    })).toEqual({
      phase: 'raw-generation',
      frameIndex: 2,
      provider: 'comfyui',
      promptId: 'P3',
      nodeId: '15',
      reason: 'UR_RESULT_ERROR_OUT_OF_DEVICE_MEMORY',
      name: 'Error',
      message,
    });
  });

  it('keeps non-provider failures explicit instead of inventing a stage', () => {
    expect(createE2eFailureEvidence('unexpected failure', {phase: 'unknown'})).toEqual({
      phase: 'unknown',
      name: 'Error',
      message: 'unexpected failure',
    });
  });

  it('measures visible, edge and opaque green residuals without counting transparent RGB', () => {
    const pixels = Uint8Array.from([
      0, 255, 0, 0,
      255, 255, 255, 255,
      0, 200, 0, 128,
      0, 200, 0, 255,
    ]);

    expect(measureRgbaQuality({width: 2, height: 2, pixels})).toEqual({
      alphaThreshold: 8,
      opaqueThreshold: 247,
      foregroundCoverage: 3 / 4,
      meanAlpha: 638 / 1020,
      softEdgeRatio: 1 / 3,
      visibleGreenSpillRatio: 2 / 3,
      edgeGreenSpillRatio: 1,
      opaqueGreenResidualRatio: 1 / 3,
    });
  });

  it('rejects malformed RGBA quality inputs and invalid thresholds', () => {
    expect(() => measureRgbaQuality({width: 1, height: 1, pixels: new Uint8Array(3)})).toThrow(
      /dimensions do not match/u,
    );
    expect(() => measureRgbaQuality({width: 1, height: 1, pixels: new Uint8Array(4)}, 8, 8)).toThrow(
      /thresholds are invalid/u,
    );
  });
});
