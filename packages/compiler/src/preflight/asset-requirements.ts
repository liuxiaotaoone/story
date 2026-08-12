import type {AssetRequirement, DirectorPlan, ExpandedAction} from '@pose-clip/schemas';

export function resolveAssetRequirements(plan: DirectorPlan, actions: readonly ExpandedAction[]): AssetRequirement[] {
  const requirements: AssetRequirement[] = [];
  const seen = new Set<string>();
  const add = (requirement: AssetRequirement): void => {
    const key = JSON.stringify(requirement);
    if (!seen.has(key)) requirements.push(requirement);
    seen.add(key);
  };
  for (const scene of plan.scenes) {
    add({id: `asset.environment.${scene.id}`, kind: 'environment-layer', environmentIntent: scene.environmentIntent, required: true});
  }
  const types = new Map(plan.characters.map(character => [character.characterId, character.entityType]));
  for (const action of actions) {
    add({
      id: `asset.action.${action.id}`, kind: types.get(action.actorId) === 'rabbit' ? 'animal-frame' : 'character-frame',
      entityType: types.get(action.actorId), action: action.action, direction: action.direction, required: action.priority === 'required',
    });
  }
  return requirements;
}
