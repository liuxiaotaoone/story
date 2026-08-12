import {
  CapabilityCatalogSchema,
  EffectiveDirectorPlanSchema,
  PreflightCompileResultSchema,
  canonicalHash,
  type CapabilityCatalog,
  type EffectiveDirectorPlan,
  type PreflightCompileResult,
  type CompileDiagnostic,
  type TtsRequest,
} from '@pose-clip/schemas';
import {assertEffectiveDirectorPlanIntegrity, hashCapabilityCatalog} from '../integrity/hash-integrity.js';
import {hashPreflightCompileResultPayload} from '../integrity/preflight-integrity.js';
import type {PreflightCompileResultPayload} from '../integrity/preflight-integrity.js';
import {resolveAssetRequirements} from './asset-requirements.js';
import {resolveActions, validatePlanCapabilities} from './capability-resolution.js';
import {segmentNarration} from './narration-segmentation.js';

export async function compilePreflight(input: {
  effectiveDirectorPlan: EffectiveDirectorPlan;
  capabilityCatalog: CapabilityCatalog;
}): Promise<PreflightCompileResult> {
  const effective = await assertEffectiveDirectorPlanIntegrity(EffectiveDirectorPlanSchema.parse(input.effectiveDirectorPlan));
  const catalog = CapabilityCatalogSchema.parse(input.capabilityCatalog);
  const capabilityCatalogHash = await hashCapabilityCatalog(catalog);
  const plan = effective.plan;
  const narrationSegments = segmentNarration(plan.narration, plan.shots.map(shot => shot.id));
  const intents = new Map(plan.narration.map(intent => [intent.id, intent]));
  const ttsRequests: TtsRequest[] = [];
  for (const segment of narrationSegments) {
    const intent = intents.get(segment.narrationIntentId)!;
    ttsRequests.push({
      id: `tts.${segment.id}`, segmentId: segment.id, text: segment.text, voiceId: intent.voiceId,
      speed: intent.speed, language: segment.language,
      inputHash: await canonicalHash('tts-request-input-v1', {
        text: segment.text, voiceId: intent.voiceId, speed: intent.speed, language: segment.language,
      }),
    });
  }
  const characterTypes = new Map(plan.characters.map(character => [character.characterId, character.entityType]));
  const capabilityValidation = validatePlanCapabilities(plan, catalog);
  const actionResolution = resolveActions(plan.actions, characterTypes, catalog, plan.shots.map(shot => shot.id));
  const assetRequirements = resolveAssetRequirements(plan, actionResolution.expandedActions, catalog);
  const payload: PreflightCompileResultPayload = {
    schemaVersion: '1.0.0', effectiveDirectorPlanHash: effective.effectivePlanHash,
    capabilityCatalogVersion: catalog.catalogVersion, capabilityCatalogHash,
    narrationSegments, ttsRequests, assetRequirements,
    expandedActions: actionResolution.expandedActions,
    diagnostics: [...capabilityValidation.diagnostics, ...actionResolution.diagnostics] satisfies CompileDiagnostic[],
  };
  return PreflightCompileResultSchema.parse({...payload, preflightHash: await hashPreflightCompileResultPayload(payload)});
}
