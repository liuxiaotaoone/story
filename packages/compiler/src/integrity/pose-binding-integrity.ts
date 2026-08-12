import type {
  EffectiveDirectorPlan,
  PreflightCompileResult,
  ResolvedAssetCatalog,
} from '@pose-clip/schemas';
import {CompileIntegrityError} from './hash-integrity.js';

export function assertRequiredActionPoseClipsResolved(
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

  for (const action of preflight.expandedActions.filter(candidate => candidate.priority === 'required')) {
    const character = characters.get(action.actorId);
    if (character === undefined) throw new CompileIntegrityError(`ExpandedAction ${action.id} references unknown actor ${action.actorId}`);
    const definitionId = bindings.get(character.characterId)!;
    const definition = definitions.get(definitionId)!;
    const clip = poseClips.get(action.poseClipId);
    if (clip === undefined) throw new CompileIntegrityError(`Required PoseClip ${action.poseClipId} does not exist`);
    if (clip.entityType !== character.entityType) throw new CompileIntegrityError(`Required PoseClip ${action.poseClipId} has wrong entityType for ${character.characterId}`);
    if (!definition.poseClipIds.includes(action.poseClipId)) {
      throw new CompileIntegrityError(`EntityDefinition ${definition.id} does not declare required PoseClip ${action.poseClipId}`);
    }
  }
}

export const assertRequiredPoseClipsResolved = assertRequiredActionPoseClipsResolved;
