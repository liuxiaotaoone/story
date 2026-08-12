import {describe, expect, it} from 'vitest';
import {DirectorOverrideSchema} from '@pose-clip/schemas';
import {DirectorOverrideError, applyDirectorOverrides, hashDirectorPlan} from '../src/index.js';
import {storyDirectorPlan} from './fixture.js';

describe('DirectorOverride application', () => {
  it('applies an allowed semantic override and revalidates the effective plan', async () => {
    const hash = await hashDirectorPlan(storyDirectorPlan);
    const effective = await applyDirectorOverrides(storyDirectorPlan, [{
      id: 'override-narration', sourceDirectorPlanHash: hash, targetPath: '/narration/0/text',
      operation: 'replace', value: 'A rabbit ran toward the old tree.', reason: 'Shorten the line',
      createdBy: 'reviewer', createdAt: '2026-08-12T00:00:00.000Z',
    }]);
    expect(effective.plan.narration[0]?.text).toBe('A rabbit ran toward the old tree.');
    expect(effective.overrideIds).toEqual(['override-narration']);
    expect(effective.effectivePlanHash).not.toBe(hash);
  });

  it('rejects a stale source hash and RenderPlan/Timeline paths', async () => {
    await expect(applyDirectorOverrides(storyDirectorPlan, [{
      id: 'stale', sourceDirectorPlanHash: '0'.repeat(64), targetPath: '/actions/0/action',
      operation: 'replace', value: 'walk', reason: 'stale', createdBy: 'reviewer', createdAt: '2026-08-12T00:00:00.000Z',
    }])).rejects.toBeInstanceOf(DirectorOverrideError);
    expect(DirectorOverrideSchema.safeParse({
      id: 'bad', sourceDirectorPlanHash: '0'.repeat(64), targetPath: '/timeline/entityTracks/0',
      operation: 'replace', value: {}, reason: 'bad boundary', createdBy: 'reviewer', createdAt: '2026-08-12T00:00:00.000Z',
    }).success).toBe(false);
    expect(DirectorOverrideSchema.safeParse({
      id: 'bad-character', sourceDirectorPlanHash: '0'.repeat(64), targetPath: '/characters/0/role',
      operation: 'replace', value: 'lead', reason: 'outside allowed semantic roots',
      createdBy: 'reviewer', createdAt: '2026-08-12T00:00:00.000Z',
    }).success).toBe(false);
  });
});
