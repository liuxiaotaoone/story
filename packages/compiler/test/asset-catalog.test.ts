import {describe, expect, it} from 'vitest';
import {ResolvedAssetCatalogSchema} from '@pose-clip/schemas';
import {
  assertAssetRequirementsResolved,
  assertResolvedAssetCatalogIntegrity,
  compilePreflight,
  createEffectiveDirectorPlan,
  hashResolvedAssetCatalogPayload,
} from '../src/index.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';

describe('ResolvedAssetCatalog contract', () => {
  it('allows experiment mode but keeps the productionReady gate explicit', () => {
    const base = {
      schemaVersion: '1.0.0', catalogHash: '0'.repeat(64),
      assets: {schemaVersion: '1.0.0', assets: []}, poseClips: [], environments: [], entityDefinitions: [], characterBindings: [],
    };
    expect(ResolvedAssetCatalogSchema.safeParse({...base, mode: 'experiment', productionReady: false}).success).toBe(true);
    expect(ResolvedAssetCatalogSchema.safeParse({...base, mode: 'production', productionReady: false}).success).toBe(false);
  });

  it('protects catalog content and rejects unresolved required assets', async () => {
    const payload = {
      schemaVersion: '1.0.0' as const, mode: 'experiment' as const, productionReady: false,
      assets: {schemaVersion: '1.0.0' as const, assets: []}, poseClips: [], environments: [], entityDefinitions: [], characterBindings: [],
    };
    const catalog = {...payload, catalogHash: await hashResolvedAssetCatalogPayload(payload)};
    await expect(assertResolvedAssetCatalogIntegrity(catalog)).resolves.toEqual(catalog);
    await expect(assertResolvedAssetCatalogIntegrity({...catalog, productionReady: true})).rejects.toThrow(/catalogHash/u);

    const effective = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
    const preflight = await compilePreflight({effectiveDirectorPlan: effective, capabilityCatalog});
    expect(() => assertAssetRequirementsResolved(preflight, catalog)).toThrow(/Required environment/u);
  });
});
