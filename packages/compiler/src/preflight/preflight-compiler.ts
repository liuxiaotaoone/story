import {
  CapabilityCatalogSchema,
  EffectiveDirectorPlanSchema,
  PreflightCompileResultSchema,
  canonicalHash,
  type CapabilityCatalog,
  type EffectiveDirectorPlan,
  type PreflightCompileResult,
  type TtsRequest,
} from '@pose-clip/schemas';
import {resolveAssetRequirements} from './asset-requirements.js';
import {resolveActions, validatePlanCapabilities} from './capability-resolution.js';
import {segmentNarration} from './narration-segmentation.js';

export async function compilePreflight(input: {
  effectiveDirectorPlan: EffectiveDirectorPlan;
  capabilityCatalog: CapabilityCatalog;
}): Promise<PreflightCompileResult> {
  const effective = EffectiveDirectorPlanSchema.parse(input.effectiveDirectorPlan);
  const catalog = CapabilityCatalogSchema.parse(input.capabilityCatalog);
  const plan = effective.plan;
  const narrationSegments = segmentNarration(plan.narration);
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
  const actionResolution = resolveActions(plan.actions, characterTypes, catalog);
  const assetRequirements = resolveAssetRequirements(plan, actionResolution.expandedActions);
  return PreflightCompileResultSchema.parse({
    schemaVersion: '1.0.0', effectiveDirectorPlanHash: effective.effectivePlanHash,
    narrationSegments, ttsRequests, assetRequirements,
    expandedActions: actionResolution.expandedActions,
    diagnostics: [...capabilityValidation.diagnostics, ...actionResolution.diagnostics],
  });
}
