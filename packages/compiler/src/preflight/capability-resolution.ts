import type {
  ActionCapability,
  ActionIntent,
  CapabilityCatalog,
  CameraIntentDefinition,
  CharacterBlockingIntent,
  CompileDiagnostic,
  DirectorPlan,
  ExpandedAction,
} from '@pose-clip/schemas';

export interface ActionResolution {
  expandedActions: ExpandedAction[];
  diagnostics: CompileDiagnostic[];
}

export interface CapabilityValidation {
  diagnostics: CompileDiagnostic[];
}

function capabilityFor(catalog: CapabilityCatalog, actorType: string, action: string): ActionCapability | undefined {
  return catalog.entityCapabilities.find(entity => entity.entityType === actorType)?.actions.find(candidate => candidate.action === action);
}

export function resolveActions(
  actions: readonly ActionIntent[],
  characterTypes: ReadonlyMap<string, string>,
  catalog: CapabilityCatalog,
): ActionResolution {
  const expandedActions: ExpandedAction[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  for (const action of actions) {
    if (!action.enabled) continue;
    const actorType = characterTypes.get(action.actorId);
    if (actorType === undefined) continue; // DirectorPlan validation reports this earlier.
    let actionName = action.action;
    let capability = capabilityFor(catalog, actorType, actionName);
    let rewrite: ExpandedAction['rewrite'];
    if (capability === undefined) {
      const fallback = catalog.fallbackRules.find(rule => rule.unsupportedAction === actionName);
      const replacement = fallback?.replacementActions.find(candidate => capabilityFor(catalog, actorType, candidate) !== undefined);
      if (fallback !== undefined && replacement !== undefined) {
        rewrite = {fromAction: actionName, ruleReason: fallback.reason};
        actionName = replacement;
        capability = capabilityFor(catalog, actorType, replacement);
        diagnostics.push({
          id: `diagnostic.${action.id}.rewrite`, severity: 'warning', code: 'ACTION_REWRITTEN',
          message: `${action.action} was rewritten to ${replacement}: ${fallback.reason}`,
          sourceId: action.id, path: `/actions/${action.id}`, recoverable: true, suggestedFallbacks: [replacement],
        });
      }
    }
    if (capability === undefined) {
      diagnostics.push({
        id: `diagnostic.${action.id}.unsupported`, severity: action.priority === 'required' ? 'error' : 'warning',
        code: 'UNSUPPORTED_CAPABILITY', message: `No ${actionName} capability exists for ${actorType}`,
        sourceId: action.id, path: `/actions/${action.id}`, recoverable: action.priority === 'optional',
        suggestedFallbacks: catalog.fallbackRules.find(rule => rule.unsupportedAction === actionName)?.replacementActions,
      });
      continue;
    }
    const entityCapability = catalog.entityCapabilities.find(entity => entity.entityType === actorType)!;
    const missingPoseClip = capability.requiredPoseClips.find(poseClipId => !entityCapability.poseClips.includes(poseClipId));
    if (missingPoseClip !== undefined) {
      diagnostics.push({
        id: `diagnostic.${action.id}.pose-clip`, severity: 'error', code: 'MISSING_POSE_CLIP',
        message: `${actionName} requires unavailable PoseClip ${missingPoseClip} for ${actorType}`,
        sourceId: action.id, path: `/actions/${action.id}`, recoverable: false,
      });
      continue;
    }
    if (action.targetId !== undefined && capability.targetTypes !== undefined) {
      const targetType = characterTypes.get(action.targetId);
      if (targetType === undefined || !capability.targetTypes.includes(targetType)) {
        diagnostics.push({
          id: `diagnostic.${action.id}.target`, severity: 'error', code: 'UNSUPPORTED_CAPABILITY',
          message: `${actionName} cannot target ${targetType ?? action.targetId}`,
          sourceId: action.id, path: `/actions/${action.id}/targetId`, recoverable: false,
        });
        continue;
      }
    }
    const direction = action.direction ?? capability.supportsDirections[0]!;
    if (!capability.supportsDirections.includes(direction)) {
      diagnostics.push({
        id: `diagnostic.${action.id}.direction`, severity: 'error', code: 'UNSUPPORTED_CAPABILITY',
        message: `${actionName} does not support direction ${direction}`, sourceId: action.id,
        path: `/actions/${action.id}/direction`, recoverable: false,
      });
      continue;
    }
    expandedActions.push({
      id: `expanded.${action.id}`, sourceActionId: action.id, sceneId: action.sceneId, shotId: action.shotId,
      actorId: action.actorId, action: actionName, ...(action.targetId === undefined ? {} : {targetId: action.targetId}),
      direction, priority: action.priority, minDurationFrames: capability.minDurationFrames,
      requiredPoseClipIds: capability.requiredPoseClips, ...(rewrite === undefined ? {} : {rewrite}),
    });
  }
  return {expandedActions, diagnostics};
}

function validateCameras(
  cameras: readonly CameraIntentDefinition[],
  plan: DirectorPlan,
  catalog: CapabilityCatalog,
): CompileDiagnostic[] {
  return cameras.flatMap(camera => {
    const shot = plan.shots.find(candidate => candidate.id === camera.shotId)!;
    const capability = catalog.cameraCapabilities.find(candidate => candidate.intent === camera.type);
    if (capability === undefined || !capability.allowedShotTypes.includes(shot.shotType)) {
      return [{
        id: `diagnostic.${camera.id}.camera`, severity: 'error' as const, code: 'CAMERA_UNRESOLVABLE' as const,
        message: capability === undefined
          ? `Camera intent ${camera.type} is not in the Capability Catalog`
          : `Camera intent ${camera.type} does not support ${shot.shotType} shots`,
        sourceId: camera.id, path: `/cameraIntents/${camera.id}`, recoverable: false,
      }];
    }
    return [];
  });
}

function validateBlocking(
  blockingIntents: readonly CharacterBlockingIntent[],
  plan: DirectorPlan,
  catalog: CapabilityCatalog,
): CompileDiagnostic[] {
  const characterTypes = new Map(plan.characters.map(character => [character.characterId, character.entityType]));
  const diagnostics: CompileDiagnostic[] = [];
  for (const blocking of blockingIntents) {
    const scene = plan.scenes.find(candidate => candidate.id === blocking.sceneId)!;
    const environment = catalog.environmentCapabilities.find(candidate => candidate.environmentId === scene.environmentIntent);
    const entityType = characterTypes.get(blocking.characterId)!;
    if (environment === undefined) {
      diagnostics.push({
        id: `diagnostic.${blocking.id}.environment`, severity: 'error' as const, code: 'UNSUPPORTED_CAPABILITY' as const,
        message: `Environment ${scene.environmentIntent} is not in the Capability Catalog`,
        sourceId: blocking.id, path: `/scenes/${scene.id}/environmentIntent`, recoverable: false,
      });
      continue;
    }
    if (!environment.allowedEntityTypes.includes(entityType) || !environment.supportedDepthIntents.includes(blocking.blocking.depth)) {
      diagnostics.push({
        id: `diagnostic.${blocking.id}.blocking`, severity: 'error' as const, code: 'BLOCKING_UNRESOLVABLE' as const,
        message: `Environment ${scene.environmentIntent} cannot place ${entityType} at ${blocking.blocking.depth}`,
        sourceId: blocking.id, path: `/blockingIntents/${blocking.id}`, recoverable: false,
      });
    }
  }
  return diagnostics;
}

export function validatePlanCapabilities(plan: DirectorPlan, catalog: CapabilityCatalog): CapabilityValidation {
  const diagnostics: CompileDiagnostic[] = [];
  for (const environmentIntent of new Set(plan.scenes.map(scene => scene.environmentIntent))) {
    if (!catalog.environmentCapabilities.some(capability => capability.environmentId === environmentIntent)) {
      diagnostics.push({
        id: `diagnostic.environment.${environmentIntent}`, severity: 'error', code: 'UNSUPPORTED_CAPABILITY',
        message: `Environment ${environmentIntent} is not in the Capability Catalog`,
        path: '/scenes', recoverable: false,
      });
    }
  }
  diagnostics.push(...validateCameras(plan.cameraIntents, plan, catalog));
  diagnostics.push(...validateBlocking(plan.blockingIntents, plan, catalog));
  return {diagnostics};
}
