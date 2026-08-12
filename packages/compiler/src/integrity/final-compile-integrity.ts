import {
  FinalCompileInputSchema,
  canonicalHash,
  type FinalCompileInput,
} from '@pose-clip/schemas';
import {assertEffectiveDirectorPlanIntegrity, CompileIntegrityError, hashCapabilityCatalog} from './hash-integrity.js';
import {assertPreflightCompileResultIntegrity} from './preflight-integrity.js';
import {assertAssetRequirementsResolved, assertResolvedAssetCatalogIntegrity} from './asset-catalog-integrity.js';

export async function assertFinalCompileInputIntegrity(input: FinalCompileInput): Promise<FinalCompileInput> {
  const parsed = FinalCompileInputSchema.parse(input);
  await assertEffectiveDirectorPlanIntegrity(parsed.effectiveDirectorPlan);
  await assertPreflightCompileResultIntegrity(parsed.preflight);
  await assertResolvedAssetCatalogIntegrity(parsed.assetCatalog);
  const recomputedTtsRequests = await Promise.all(parsed.preflight.ttsRequests.map(async request => ({
    id: request.id,
    inputHash: await canonicalHash('tts-request-input-v1', {
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
  }
  const catalogHash = await hashCapabilityCatalog(parsed.capabilityCatalog);
  if (catalogHash !== parsed.preflight.capabilityCatalogHash) {
    throw new CompileIntegrityError('Preflight was compiled from a different Capability Catalog');
  }
  assertAssetRequirementsResolved(parsed.preflight, parsed.assetCatalog);
  return parsed;
}
