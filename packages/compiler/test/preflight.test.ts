import {describe, expect, it} from 'vitest';
import {PreflightCompileResultSchema} from '@pose-clip/schemas';
import {compilePreflight, createEffectiveDirectorPlan, resolveActions} from '../src/index.js';
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

  it('rejects an interactive action without targetId during Preflight resolution', () => {
    const interactiveCatalog = structuredClone(capabilityCatalog);
    interactiveCatalog.entityCapabilities[0]!.actions[0]!.targetPolicy = 'required';
    interactiveCatalog.entityCapabilities[0]!.actions[0]!.targetTypes = ['stump'];
    interactiveCatalog.entityCapabilities[0]!.actions[0]!.interaction = {
      contact: {targetAnchorId: 'impact'}, effect: {effectType: 'impact', trigger: 'action-start', durationFrames: 10},
    };
    const action = {...storyDirectorPlan.actions[0]!, targetId: undefined};
    const result = resolveActions([action], new Map([['rabbit', 'rabbit']]), interactiveCatalog, ['shot-run']);
    expect(result.expandedActions).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      severity: 'error', code: 'ACTION_TARGET_REQUIRED', sourceId: action.id,
    })]);
  });

  it('enforces none, optional and required target policies independently of interaction metadata', () => {
    const baseAction = storyDirectorPlan.actions[0]!;
    const baseCapability = capabilityCatalog.entityCapabilities[0]!.actions[0]!;
    const withPolicy = (targetPolicy: 'none' | 'optional' | 'required') => ({
      ...capabilityCatalog,
      entityCapabilities: [{
        ...capabilityCatalog.entityCapabilities[0]!,
        actions: [{
          ...baseCapability,
          targetPolicy,
          ...(targetPolicy === 'none' ? {} : {targetTypes: ['stump']}),
        }],
      }, capabilityCatalog.entityCapabilities[1]!],
    });

    const forbidden = resolveActions(
      [{...baseAction, targetId: 'stump'}],
      new Map([['rabbit', 'rabbit'], ['stump', 'stump']]),
      withPolicy('none'),
    );
    expect(forbidden.diagnostics).toContainEqual(expect.objectContaining({code: 'ACTION_TARGET_FORBIDDEN'}));

    const optional = resolveActions(
      [{...baseAction, targetId: undefined}],
      new Map([['rabbit', 'rabbit'], ['stump', 'stump']]),
      withPolicy('optional'),
    );
    expect(optional.expandedActions).toHaveLength(1);

    const required = resolveActions(
      [{...baseAction, targetId: undefined}],
      new Map([['rabbit', 'rabbit'], ['stump', 'stump']]),
      withPolicy('required'),
    );
    expect(required.diagnostics).toContainEqual(expect.objectContaining({code: 'ACTION_TARGET_REQUIRED'}));
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
