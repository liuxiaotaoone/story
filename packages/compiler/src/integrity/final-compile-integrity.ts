import {
  FinalCompileInputSchema,
  hashTtsRequestInput,
  type FinalCompileInput,
} from '@pose-clip/schemas';
import {assertEffectiveDirectorPlanIntegrity, CompileIntegrityError, hashCapabilityCatalog} from './hash-integrity.js';
import {assertPreflightCompileResultIntegrity} from './preflight-integrity.js';
import {assertAssetRequirementsResolved, assertResolvedAssetCatalogIntegrity} from './asset-catalog-integrity.js';
import {assertRequiredActionPoseClipsResolved} from './pose-binding-integrity.js';

export async function assertFinalCompileInputIntegrity(input: FinalCompileInput): Promise<FinalCompileInput> {
  const parsed = FinalCompileInputSchema.parse(input);
  await assertEffectiveDirectorPlanIntegrity(parsed.effectiveDirectorPlan);
  await assertPreflightCompileResultIntegrity(parsed.preflight);
  await assertResolvedAssetCatalogIntegrity(parsed.assetCatalog);
  const catalogHash = await hashCapabilityCatalog(parsed.capabilityCatalog);
  if (catalogHash !== parsed.preflight.capabilityCatalogHash) {
    throw new CompileIntegrityError('Preflight was compiled from a different Capability Catalog');
  }
  const recomputedTtsRequests = await Promise.all(parsed.preflight.ttsRequests.map(async request => ({
    id: request.id,
    inputHash: await hashTtsRequestInput({
      text: request.text,
      voiceId: request.voiceId,
      speed: request.speed,
      language: request.language,
    }),
  })));
  for (const request of recomputedTtsRequests) {
    if (request.inputHash !== parsed.preflight.ttsRequests.find(candidate => candidate.id === request.id)?.inputHash) {
      throw new CompileIntegrityError(`TTS request ${request.id} content does not match inputHash`);
    }
  }
  for (const audio of parsed.measuredAudio) {
    const request = parsed.preflight.ttsRequests.find(candidate => candidate.id === audio.requestId)!;
    if (audio.sourceTtsRequestHash !== request.inputHash) {
      throw new CompileIntegrityError(`MeasuredAudio ${audio.assetId} was produced from a different TTS request`);
    }
    const asset = parsed.assetCatalog.assets.assets.find(candidate => candidate.id === audio.assetId);
    if (asset === undefined) {
      throw new CompileIntegrityError(`MeasuredAudio asset ${audio.assetId} does not exist in ResolvedAssetCatalog`);
    }
    if (asset.kind !== 'audio') {
      throw new CompileIntegrityError(`MeasuredAudio asset ${audio.assetId} is not an audio asset`);
    }
    if (asset.contentHash !== audio.contentHash) {
      throw new CompileIntegrityError(`MeasuredAudio ${audio.assetId} contentHash does not match its AssetRecord`);
    }
  }
  assertAssetRequirementsResolved(parsed.preflight, parsed.assetCatalog);
  assertRequiredActionPoseClipsResolved(parsed.effectiveDirectorPlan, parsed.preflight, parsed.assetCatalog);
  return parsed;
}
