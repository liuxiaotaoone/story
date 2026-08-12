import {describe, expect, it} from 'vitest';
import {PreflightCompileResultSchema} from '@pose-clip/schemas';
import {compilePreflight, createEffectiveDirectorPlan} from '../src/index.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';
import golden from './golden/preflight-waiting-rabbit.json' with {type: 'json'};

describe('Preflight Compiler', () => {
  it('expands actions, rewrites supported fallbacks and generates deterministic TTS requests', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
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
      capabilityCatalogHash: undefined,
      preflightHash: undefined,
      ttsRequests: first.ttsRequests.map(({inputHash: _inputHash, ...request}) => request),
    };
    const {
      effectiveDirectorPlanHash: _effectiveHash,
      capabilityCatalogHash: _catalogHash,
      preflightHash: _preflightHash,
      ...projection
    } = withoutHashes;
    expect(projection).toEqual(golden);
  });

  it('has no Timeline, frame keyframes, or pixel-space fields', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const serialized = JSON.stringify(preflight);
    expect(serialized).not.toMatch(/timeline|startFrame|endFrame|worldPosition|groundPosition|pixel|pixi/i);
    expect(preflight).not.toHaveProperty('timeline');
  });

  it('reports camera, environment and blocking capability failures before final compile', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
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

  it('rejects duplicate persisted IDs and enforces Segment to TTS one-to-one mapping', async () => {
    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const duplicateCases = [
      {...preflight, narrationSegments: [...preflight.narrationSegments, preflight.narrationSegments[0]!]},
      {...preflight, ttsRequests: [...preflight.ttsRequests, preflight.ttsRequests[0]!]},
      {...preflight, expandedActions: [...preflight.expandedActions, preflight.expandedActions[0]!]},
      {...preflight, assetRequirements: [...preflight.assetRequirements, preflight.assetRequirements[0]!]},
      {...preflight, diagnostics: [...preflight.diagnostics, preflight.diagnostics[0]!]},
    ];
    for (const candidate of duplicateCases) expect(PreflightCompileResultSchema.safeParse(candidate).success).toBe(false);
    expect(PreflightCompileResultSchema.safeParse({
      ...preflight,
      ttsRequests: preflight.ttsRequests.slice(1),
    }).success).toBe(false);
    expect(PreflightCompileResultSchema.safeParse({
      ...preflight,
      ttsRequests: [
        ...preflight.ttsRequests,
        {...preflight.ttsRequests[0]!, id: 'tts.duplicate-segment'},
      ],
    }).success).toBe(false);
  });
});
