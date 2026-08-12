import type {
  EffectiveDirectorPlan,
  PreflightCompileResult,
  ResolvedAssetCatalog,
} from '@pose-clip/schemas';
import {CompileIntegrityError} from './hash-integrity.js';

export function assertRequiredPoseClipsResolved(
  effective: EffectiveDirectorPlan,
  preflight: PreflightCompileResult,
  catalog: ResolvedAssetCatalog,
): void {
  const characters = new Map(effective.plan.characters.map(character => [character.characterId, character]));
  const bindings = new Map(catalog.characterBindings.map(binding => [binding.characterId, binding.entityDefinitionId]));
  const definitions = new Map(catalog.entityDefinitions.map(definition => [definition.id, definition]));
  const poseClips = new Map(catalog.poseClips.map(clip => [clip.id, clip]));

  for (const binding of catalog.characterBindings) {
    if (!characters.has(binding.characterId)) {
      throw new CompileIntegrityError(`Character binding references unknown Director character ${binding.characterId}`);
    }
  }

  for (const character of effective.plan.characters) {
    const definitionId = bindings.get(character.characterId);
    if (definitionId === undefined) throw new CompileIntegrityError(`Character ${character.characterId} has no explicit asset binding`);
    const definition = definitions.get(definitionId);
    if (definition === undefined) throw new CompileIntegrityError(`Character ${character.characterId} binding references missing EntityDefinition ${definitionId}`);
    if (definition.entityType !== character.entityType) {
      throw new CompileIntegrityError(`Character ${character.characterId} entityType does not match EntityDefinition ${definitionId}`);
    }
  }

  for (const action of preflight.expandedActions) {
    const character = characters.get(action.actorId);
    if (character === undefined) throw new CompileIntegrityError(`ExpandedAction ${action.id} references unknown actor ${action.actorId}`);
    const definitionId = bindings.get(character.characterId)!;
    const definition = definitions.get(definitionId)!;
    for (const poseClipId of action.requiredPoseClipIds) {
      const clip = poseClips.get(poseClipId);
      if (clip === undefined) throw new CompileIntegrityError(`Required PoseClip ${poseClipId} does not exist`);
      if (clip.entityType !== character.entityType) throw new CompileIntegrityError(`Required PoseClip ${poseClipId} has wrong entityType for ${character.characterId}`);
      if (!definition.poseClipIds.includes(poseClipId)) {
        throw new CompileIntegrityError(`EntityDefinition ${definition.id} does not declare required PoseClip ${poseClipId}`);
      }
    }
  }
}
