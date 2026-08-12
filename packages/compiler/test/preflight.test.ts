import {describe, expect, it} from 'vitest';
import {applyDirectorOverrides, compilePreflight} from '../src/index.js';
import {capabilityCatalog, storyDirectorPlan} from './fixture.js';
import golden from './golden/preflight-waiting-rabbit.json' with {type: 'json'};

describe('Preflight Compiler', () => {
  it('expands actions, rewrites supported fallbacks and generates deterministic TTS requests', async () => {
    const effective = await applyDirectorOverrides(storyDirectorPlan, []);
    const first = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const second = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    expect(second).toEqual(first);
    expect(first.narrationSegments).toHaveLength(2);
    expect(first.ttsRequests).toHaveLength(2);
    expect(first.expandedActions.map(action => action.action)).toEqual(['run', 'notice']);
    expect(first.diagnostics).toContainEqual(expect.objectContaining({code: 'ACTION_REWRITTEN', severity: 'warning'}));
    expect(first.assetRequirements).toContainEqual(expect.objectContaining({environmentIntent: 'pastoral-field'}));
    const withoutHashes = {
      ...first,
      effectiveDirectorPlanHash: undefined,
      ttsRequests: first.ttsRequests.map(({inputHash: _inputHash, ...request}) => request),
    };
    const {effectiveDirectorPlanHash: _effectiveHash, ...projection} = withoutHashes;
    expect(projection).toEqual(golden);
  });

  it('has no Timeline, frame keyframes, or pixel-space fields', async () => {
    const effective = await applyDirectorOverrides(storyDirectorPlan, []);
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const serialized = JSON.stringify(preflight);
    expect(serialized).not.toMatch(/timeline|startFrame|endFrame|worldPosition|groundPosition|pixel|pixi/i);
    expect(preflight).not.toHaveProperty('timeline');
  });

  it('reports camera, environment and blocking capability failures before final compile', async () => {
    const effective = await applyDirectorOverrides(storyDirectorPlan, []);
    const restrictedCatalog = {
      ...capabilityCatalog,
      cameraCapabilities: [],
      environmentCapabilities: [{
        environmentId: 'pastoral-field',
        allowedEntityTypes: ['rabbit'],
        supportedDepthIntents: ['background' as const],
      }],
    };
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog: restrictedCatalog});
    expect(preflight.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'CAMERA_UNRESOLVABLE', severity: 'error'}),
      expect.objectContaining({code: 'BLOCKING_UNRESOLVABLE', severity: 'error'}),
    ]));
  });
});
