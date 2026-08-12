import {describe, expect, it} from 'vitest';
import {compilePreflight, createEffectiveDirectorPlan, hashResolvedAssetCatalogPayload} from '../src/index.js';
import {capabilityCatalog, sourceStory, storyDirectorPlan} from './fixture.js';
import {assertFinalCompileInputIntegrity} from '../src/index.js';

async function baseInput() {
  const effectiveDirectorPlan = await createEffectiveDirectorPlan({story: sourceStory, directorPlan: storyDirectorPlan, overrides: []});
  const preflight = await compilePreflight({effectiveDirectorPlan, capabilityCatalog});
  const measuredAudio = preflight.ttsRequests.map(request => ({
    requestId: request.id, sourceTtsRequestHash: request.inputHash, assetId: `audio.${request.id}`,
    sampleRate: 48_000, sampleFrameCount: 48_000, channels: 1, contentHash: '1'.repeat(64),
    measurementProducer: {name: 'test-measurer', version: '1.0.0'},
  }));
  const audioAssets = measuredAudio.map(audio => ({
    id: audio.assetId, kind: 'audio' as const, uri: `${audio.assetId}.wav`, contentHash: audio.contentHash,
    source: 'manual' as const, qaStatus: 'passed' as const,
  }));
  const assetCatalogPayload = {
    schemaVersion: '1.0.0' as const, mode: 'experiment' as const, productionReady: false,
    assets: {schemaVersion: '1.0.0' as const, assets: audioAssets}, poseClips: [], environments: [], entityDefinitions: [],
  };
  const assetCatalog = {...assetCatalogPayload, catalogHash: await hashResolvedAssetCatalogPayload(assetCatalogPayload)};
  return {effectiveDirectorPlan, preflight, measuredAudio, capabilityCatalog, assetCatalog};
}

describe('Final audio asset binding', () => {
  it('rejects missing, non-audio and content-mismatched AssetRecords', async () => {
    const input = await baseInput();
    await expect(assertFinalCompileInputIntegrity(input)).rejects.toThrow(/Required environment/u);

    const missingPayload = {...input.assetCatalog, catalogHash: undefined, assets: {schemaVersion: '1.0.0' as const, assets: input.assetCatalog.assets.assets.slice(1)}};
    const {catalogHash: _missing, ...missingBody} = missingPayload;
    await expect(assertFinalCompileInputIntegrity({
      ...input,
      assetCatalog: {...missingBody, catalogHash: await hashResolvedAssetCatalogPayload(missingBody)},
    })).rejects.toThrow(/does not exist/u);

    const mismatchAssets = input.assetCatalog.assets.assets.map((asset, index) => index === 0 ? {...asset, contentHash: '2'.repeat(64)} : asset);
    const mismatchBody = {...input.assetCatalog, assets: {...input.assetCatalog.assets, assets: mismatchAssets}};
    const {catalogHash: _oldHash, ...mismatchPayload} = mismatchBody;
    await expect(assertFinalCompileInputIntegrity({
      ...input,
      assetCatalog: {...mismatchPayload, catalogHash: await hashResolvedAssetCatalogPayload(mismatchPayload)},
    })).rejects.toThrow(/contentHash does not match/u);

    const nonAudioAssets = input.assetCatalog.assets.assets.map((asset, index) => index === 0 ? {...asset, kind: 'font' as const} : asset);
    const nonAudioBody = {...input.assetCatalog, assets: {...input.assetCatalog.assets, assets: nonAudioAssets}};
    const {catalogHash: _nonAudioHash, ...nonAudioPayload} = nonAudioBody;
    await expect(assertFinalCompileInputIntegrity({
      ...input,
      assetCatalog: {...nonAudioPayload, catalogHash: await hashResolvedAssetCatalogPayload(nonAudioPayload)},
    })).rejects.toThrow(/is not an audio asset/u);
  });
});
