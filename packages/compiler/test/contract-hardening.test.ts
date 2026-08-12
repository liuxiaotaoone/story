import {describe, expect, it} from 'vitest';
import {
  CapabilityCatalogSchema,
  DirectorPlanSchema,
  FinalCompileInputSchema,
  type CapabilityCatalog,
} from '@pose-clip/schemas';
import {
  CompileIntegrityError,
  StoryDirectorIntegrityError,
  applyDirectorOverrides,
  assertFinalCompileInputIntegrity,
  compilePreflight,
  validateDirectorPlanAgainstStory,
} from '../src/index.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';

describe('M2 contract hardening', () => {
  it('binds DirectorPlan to exact Story content, beat ids and character entity types', async () => {
    await expect(validateDirectorPlanAgainstStory(sourceStory, storyDirectorPlan)).resolves.toBeUndefined();
    await expect(validateDirectorPlanAgainstStory(
      {...sourceStory, synopsis: 'The Story changed but its id did not.'},
      storyDirectorPlan,
    )).rejects.toBeInstanceOf(StoryDirectorIntegrityError);
    await expect(validateDirectorPlanAgainstStory(sourceStory, {
      ...storyDirectorPlan,
      scenes: [{...storyDirectorPlan.scenes[0]!, sourceBeatIds: ['missing-beat']}],
    })).rejects.toThrow(/unknown Story beat/u);
    await expect(validateDirectorPlanAgainstStory(sourceStory, {
      ...storyDirectorPlan,
      characters: storyDirectorPlan.characters.map(character => character.characterId === 'rabbit'
        ? {...character, entityType: 'farmer'}
        : character),
    })).rejects.toThrow(/entityType/u);
    await expect(validateDirectorPlanAgainstStory(sourceStory, {
      ...storyDirectorPlan,
      characters: [...storyDirectorPlan.characters, {
        characterId: 'fox', entityType: 'fox', role: 'intruder',
        initialBlocking: {horizontal: 'right', depth: 'ground'},
      }],
    })).rejects.toThrow(/unknown Story character/u);
  });

  it('rejects forged EffectiveDirectorPlan hashes at Preflight entry', async () => {
    const effective = await applyDirectorOverrides(storyDirectorPlan, []);
    await expect(compilePreflight({
      effectiveDirectorPlan: {...effective, effectivePlanHash: 'a'.repeat(64)},
      capabilityCatalog,
    })).rejects.toBeInstanceOf(CompileIntegrityError);
  });

  it('rejects Final Compile on plan mismatch, catalog mismatch or Preflight errors', async () => {
    const effective = await applyDirectorOverrides(storyDirectorPlan, []);
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const measuredAudio = preflight.ttsRequests.map(request => ({
      requestId: request.id,
      assetId: `audio.${request.id}`,
      sampleRate: 48_000,
      sampleLength: 48_000,
      channels: 1,
      contentHash: '0'.repeat(64),
      measurementProducer: {name: 'test-wav-parser', version: '1.0.0'},
    }));
    const base = {effectiveDirectorPlan: effective, preflight, measuredAudio, capabilityCatalog};
    expect(FinalCompileInputSchema.safeParse({
      ...base,
      preflight: {...preflight, effectiveDirectorPlanHash: 'a'.repeat(64)},
    }).success).toBe(false);
    expect(FinalCompileInputSchema.safeParse({
      ...base,
      preflight: {
        ...preflight,
        diagnostics: [{id: 'diagnostic.stop', severity: 'error', code: 'UNSUPPORTED_CAPABILITY', message: 'stop', recoverable: false}],
      },
    }).success).toBe(false);
    const changedCatalog: CapabilityCatalog = {
      ...capabilityCatalog,
      fallbackRules: capabilityCatalog.fallbackRules.map(rule => ({...rule, reason: `${rule.reason} changed`})),
    };
    await expect(assertFinalCompileInputIntegrity({...base, capabilityCatalog: changedCatalog})).rejects.toThrow(/different Capability Catalog/u);
    await expect(assertFinalCompileInputIntegrity({
      ...base,
      effectiveDirectorPlan: {...effective, effectivePlanHash: 'a'.repeat(64)},
      preflight: {...preflight, effectiveDirectorPlanHash: 'a'.repeat(64)},
    })).rejects.toThrow(/does not match effectivePlanHash/u);
    await expect(assertFinalCompileInputIntegrity({
      ...base,
      preflight: {
        ...preflight,
        ttsRequests: preflight.ttsRequests.map((request, index) => index === 0
          ? {...request, text: `${request.text} changed`}
          : request),
      },
    })).rejects.toThrow(/does not match inputHash/u);
  });

  it('rejects every Capability Catalog ambiguity used by find()', () => {
    const entity = capabilityCatalog.entityCapabilities[0]!;
    const cases: CapabilityCatalog[] = [
      {...capabilityCatalog, entityCapabilities: [entity, entity]},
      {...capabilityCatalog, entityCapabilities: [{...entity, actions: [entity.actions[0]!, entity.actions[0]!]}]},
      {...capabilityCatalog, entityCapabilities: [{...entity, poseClips: ['rabbit.run-left', 'rabbit.run-left']}]},
      {...capabilityCatalog, entityCapabilities: [{...entity, attachmentSlots: ['hand', 'hand']}]},
      {...capabilityCatalog, cameraCapabilities: [capabilityCatalog.cameraCapabilities[0]!, capabilityCatalog.cameraCapabilities[0]!]},
      {...capabilityCatalog, environmentCapabilities: [capabilityCatalog.environmentCapabilities[0]!, capabilityCatalog.environmentCapabilities[0]!] },
      {...capabilityCatalog, fallbackRules: [capabilityCatalog.fallbackRules[0]!, capabilityCatalog.fallbackRules[0]!]},
    ];
    for (const candidate of cases) expect(CapabilityCatalogSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects duplicate blocking and action sequence semantics within one shot', () => {
    expect(DirectorPlanSchema.safeParse({
      ...storyDirectorPlan,
      blockingIntents: [storyDirectorPlan.blockingIntents[0]!, {...storyDirectorPlan.blockingIntents[0]!, id: 'blocking-rabbit-2'}],
    }).success).toBe(false);
    expect(DirectorPlanSchema.safeParse({
      ...storyDirectorPlan,
      actions: [storyDirectorPlan.actions[0]!, {...storyDirectorPlan.actions[0]!, id: 'action-run-2'}],
    }).success).toBe(false);
  });

  it('deduplicates logical asset requirements and records all requesting actions', async () => {
    const plan = DirectorPlanSchema.parse({
      ...storyDirectorPlan,
      actions: [
        storyDirectorPlan.actions[0]!,
        {...storyDirectorPlan.actions[0]!, id: 'action-run-again', sequence: 1},
        storyDirectorPlan.actions[1]!,
      ],
    });
    const effective = await applyDirectorOverrides(plan, []);
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    const rabbitRun = preflight.assetRequirements.filter(requirement => requirement.entityType === 'rabbit' && requirement.action === 'run');
    expect(rabbitRun).toHaveLength(1);
    expect(rabbitRun[0]?.requestedByActionIds).toEqual(['action-run', 'action-run-again']);
  });

  it('expands same-shot actions in semantic sequence order, independent of input array order', async () => {
    const plan = DirectorPlanSchema.parse({
      ...storyDirectorPlan,
      actions: [
        {...storyDirectorPlan.actions[0]!, id: 'action-run-later', sequence: 1},
        storyDirectorPlan.actions[0]!,
        storyDirectorPlan.actions[1]!,
      ],
    });
    const effective = await applyDirectorOverrides(plan, []);
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    expect(preflight.expandedActions.filter(action => action.shotId === 'shot-run').map(action => action.sequence)).toEqual([0, 1]);
  });
});
