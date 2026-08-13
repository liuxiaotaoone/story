import type {AssetRequirement, CapabilityCatalog, DirectorPlan, ExpandedAction} from '@pose-clip/schemas';

export function resolveAssetRequirements(
  plan: DirectorPlan,
  actions: readonly ExpandedAction[],
  catalog: CapabilityCatalog,
): AssetRequirement[] {
  const requirements = new Map<string, AssetRequirement>();
  const add = (key: string, requirement: AssetRequirement, sourceActionId?: string): void => {
    const existing = requirements.get(key);
    if (existing === undefined) {
      requirements.set(key, sourceActionId === undefined ? requirement : {...requirement, requestedByActionIds: [sourceActionId]});
      return;
    }
    if (sourceActionId !== undefined) {
      const requestedByActionIds = [...new Set([...(existing.requestedByActionIds ?? []), sourceActionId])];
      requirements.set(key, {...existing, required: existing.required || requirement.required, requestedByActionIds});
    }
  };
  for (const scene of plan.scenes) {
    const key = `environment-layer|${scene.environmentIntent}`;
    add(key, {id: `asset.environment.${scene.environmentIntent}`, kind: 'environment-layer', environmentIntent: scene.environmentIntent, required: true});
  }
  for (const landmark of plan.landmarks ?? []) {
    add(`prop|${landmark.landmarkType}`, {
      id: `asset.prop.${landmark.landmarkType}`, kind: 'prop', entityType: landmark.landmarkType, required: true,
    });
  }
  const types = new Map(plan.characters.map(character => [character.characterId, character.entityType]));
  const assetKinds = new Map(catalog.entityCapabilities.map(entity => [entity.entityType, entity.visualAssetKind]));
  for (const action of actions) {
    const entityType = types.get(action.actorId)!;
    const kind = assetKinds.get(entityType)!;
    const key = `${kind}|${entityType}|${action.action}|${action.direction}`;
    add(key, {
      id: `asset.${kind}.${entityType}.${action.action}.${action.direction}`,
      kind, entityType, action: action.action, direction: action.direction, required: action.priority === 'required',
    }, action.sourceActionId);
    if (action.interaction?.effect !== undefined) {
      const effectType = action.interaction.effect.effectType;
      add(`effect|${effectType}`, {
        id: `asset.effect.${effectType}`, kind: 'effect', entityType: effectType, required: action.priority === 'required',
      }, action.sourceActionId);
    }
  }
  return [...requirements.values()];
}
