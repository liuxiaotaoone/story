import {
  FinalCompileInputSchema,
  canonicalHash,
  type FinalCompileInput,
} from '@pose-clip/schemas';
import {assertEffectiveDirectorPlanIntegrity, CompileIntegrityError, hashCapabilityCatalog} from './hash-integrity.js';

export async function assertFinalCompileInputIntegrity(input: FinalCompileInput): Promise<FinalCompileInput> {
  const parsed = FinalCompileInputSchema.parse(input);
  await assertEffectiveDirectorPlanIntegrity(parsed.effectiveDirectorPlan);
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
  const catalogHash = await hashCapabilityCatalog(parsed.capabilityCatalog);
  if (catalogHash !== parsed.preflight.capabilityCatalogHash) {
    throw new CompileIntegrityError('Preflight was compiled from a different Capability Catalog');
  }
  return parsed;
}
