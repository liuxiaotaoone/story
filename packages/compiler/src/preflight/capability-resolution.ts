import type {
  ActionCapability,
  ActionIntent,
  CapabilityCatalog,
  CameraIntentDefinition,
  BlockingIntent,
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
  shotIdsInOrder?: readonly string[],
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
    const direction = action.direction ?? capability.defaultDirection;
    if (!capability.supportsDirections.includes(direction)) {
      diagnostics.push({
        id: `diagnostic.${action.id}.direction`, severity: 'error', code: 'UNSUPPORTED_CAPABILITY',
        message: `${actionName} does not support direction ${direction}`, sourceId: action.id,
        path: `/actions/${action.id}/direction`, recoverable: false,
      });
      continue;
    }
    const poseBinding = capability.poseBindings.find(binding => binding.direction === direction);
    if (poseBinding === undefined) {
      diagnostics.push({
        id: `diagnostic.${action.id}.pose-binding`, severity: 'error', code: 'MISSING_POSE_CLIP',
        message: `${actionName} has no PoseClip binding for direction ${direction}`,
        sourceId: action.id, path: `/actions/${action.id}/direction`, recoverable: false,
      });
      continue;
    }
    if (capability.spatialMode === 'locomotion' && action.destinationBlocking === undefined) {
      diagnostics.push({
        id: `diagnostic.${action.id}.destination`, severity: 'error', code: 'BLOCKING_UNRESOLVABLE',
        message: `Locomotion action ${actionName} requires destinationBlocking`,
        sourceId: action.id, path: `/actions/${action.id}/destinationBlocking`, recoverable: false,
      });
      continue;
    }
    if (capability.spatialMode === 'stationary' && action.destinationBlocking !== undefined) {
      diagnostics.push({
        id: `diagnostic.${action.id}.stationary-destination`, severity: 'error', code: 'BLOCKING_UNRESOLVABLE',
        message: `Stationary action ${actionName} cannot consume destinationBlocking`,
        sourceId: action.id, path: `/actions/${action.id}/destinationBlocking`, recoverable: false,
      });
      continue;
    }
    if (action.destinationBlocking?.facing !== undefined && action.destinationBlocking.facing !== direction) {
      diagnostics.push({
        id: `diagnostic.${action.id}.destination-facing`, severity: 'error', code: 'BLOCKING_UNRESOLVABLE',
        message: `Locomotion destination facing ${action.destinationBlocking.facing} conflicts with action direction ${direction}`,
        sourceId: action.id, path: `/actions/${action.id}/destinationBlocking/facing`, recoverable: false,
      });
      continue;
    }
    expandedActions.push({
      id: `expanded.${action.id}`, sourceActionId: action.id, sceneId: action.sceneId, shotId: action.shotId,
      actorId: action.actorId, action: actionName, sequence: action.sequence,
      ...(action.targetId === undefined ? {} : {targetId: action.targetId}),
      ...(action.durationPreference === undefined ? {} : {durationPreference: action.durationPreference}),
      direction, priority: action.priority, minDurationFrames: capability.minDurationFrames,
      poseClipId: poseBinding.poseClipId, requiredPoseClipIds: [poseBinding.poseClipId],
      completionPolicy: capability.completionPolicy, spatialMode: capability.spatialMode,
      ...(action.destinationBlocking === undefined ? {} : {destinationBlocking: action.destinationBlocking}),
      ...(capability.interaction === undefined ? {} : {interaction: capability.interaction}),
      ...(rewrite === undefined ? {} : {rewrite}),
    });
  }
  const shotOrder = new Map((shotIdsInOrder ?? [...new Set(actions.map(action => action.shotId))].sort()).map((shotId, index) => [shotId, index]));
  expandedActions.sort((left, right) =>
    (shotOrder.get(left.shotId)! - shotOrder.get(right.shotId)!)
    || (left.sequence - right.sequence)
    || left.id.localeCompare(right.id),
  );
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

function validateCharacterPlacement(input: {
  environmentId: string;
  entityType: string;
  blocking: BlockingIntent;
  sourceId: string;
  path: string;
  diagnosticId: string;
  catalog: CapabilityCatalog;
}): CompileDiagnostic[] {
  const environment = input.catalog.environmentCapabilities.find(candidate => candidate.environmentId === input.environmentId);
  if (environment === undefined) return [{
    id: `${input.diagnosticId}.environment`, severity: 'error', code: 'UNSUPPORTED_CAPABILITY',
    message: `Environment ${input.environmentId} is not in the Capability Catalog`,
    sourceId: input.sourceId, path: input.path, recoverable: false,
  }];
  if (!environment.allowedEntityTypes.includes(input.entityType)
    || !environment.supportedDepthIntents.includes(input.blocking.depth)) return [{
    id: `${input.diagnosticId}.blocking`, severity: 'error', code: 'BLOCKING_UNRESOLVABLE',
    message: `Environment ${input.environmentId} cannot place ${input.entityType} at ${input.blocking.depth}`,
    sourceId: input.sourceId, path: input.path, recoverable: false,
  }];
  return [];
}

function validatePlacements(plan: DirectorPlan, catalog: CapabilityCatalog): CompileDiagnostic[] {
  const entityTypes = new Map([
    ...plan.characters.map(character => [character.characterId, character.entityType] as const),
    ...(plan.landmarks ?? []).map(landmark => [landmark.id, landmark.landmarkType] as const),
  ]);
  const sceneEnvironment = new Map(plan.scenes.map(scene => [scene.id, scene.environmentIntent]));
  const diagnostics: CompileDiagnostic[] = [];
  const environmentIds = [...new Set(plan.scenes.map(scene => scene.environmentIntent))];
  for (const character of plan.characters) {
    for (const environmentId of environmentIds) diagnostics.push(...validateCharacterPlacement({
      environmentId, entityType: character.entityType, blocking: character.initialBlocking,
      sourceId: character.characterId, path: `/characters/${character.characterId}/initialBlocking`,
      diagnosticId: `diagnostic.${character.characterId}.initial.${environmentId}`, catalog,
    }));
  }
  for (const landmark of plan.landmarks ?? []) diagnostics.push(...validateCharacterPlacement({
    environmentId: sceneEnvironment.get(landmark.sceneId)!, entityType: landmark.landmarkType, blocking: landmark.blocking,
    sourceId: landmark.id, path: `/landmarks/${landmark.id}/blocking`, diagnosticId: `diagnostic.${landmark.id}`, catalog,
  }));
  for (const blocking of plan.blockingIntents) diagnostics.push(...validateCharacterPlacement({
    environmentId: sceneEnvironment.get(blocking.sceneId)!,
      entityType: entityTypes.get(blocking.characterId)!, blocking: blocking.blocking,
    sourceId: blocking.id, path: `/blockingIntents/${blocking.id}`,
    diagnosticId: `diagnostic.${blocking.id}`, catalog,
  }));
  for (const action of plan.actions) {
    if (!action.enabled || action.destinationBlocking === undefined) continue;
    diagnostics.push(...validateCharacterPlacement({
      environmentId: sceneEnvironment.get(action.sceneId)!,
      entityType: entityTypes.get(action.actorId)!, blocking: action.destinationBlocking,
      sourceId: action.id, path: `/actions/${action.id}/destinationBlocking`,
      diagnosticId: `diagnostic.${action.id}.destination`, catalog,
    }));
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
  diagnostics.push(...validatePlacements(plan, catalog));
  return {diagnostics};
}
