import {
  type EffectiveDirectorPlan,
  type EntityInstance,
  type PreflightCompileResult,
  type ResolvedAssetCatalog,
  type Timeline,
} from '@pose-clip/schemas';
import {evaluateGroundPointKeyframes} from '@pose-clip/paper-engine';
import type {SolvedTimingPlan} from '../timing/types.js';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const effectInstanceId = (expandedActionId: string): string => `effect.${expandedActionId}`;

export function resolveOwnershipEventFrame(
  timing: 'action-start' | 'action-end',
  solved: {startFrame: number; endFrame: number},
): number {
  // SolvedAction ranges are half-open. action-end means the final active frame,
  // never the non-rendered endFrame boundary.
  return timing === 'action-start' ? solved.startFrame : solved.endFrame - 1;
}

function solvedActions(preflight: PreflightCompileResult, timing: SolvedTimingPlan) {
  const actions = new Map(preflight.expandedActions.map(action => [action.id, action]));
  return timing.shots.flatMap(shot => shot.actions.map(solved => ({solved, action: actions.get(solved.expandedActionId)!})));
}

function environmentForScene(effective: EffectiveDirectorPlan, sceneId: string): string {
  const environmentId = effective.plan.scenes.find(scene => scene.id === sceneId)?.environmentIntent;
  if (environmentId === undefined) throw new Error(`Visual planning references unknown scene ${sceneId}`);
  return environmentId;
}

export function compileSupplementalInstances(input: {
  effective: EffectiveDirectorPlan;
  preflight: PreflightCompileResult;
  catalog: ResolvedAssetCatalog;
  timing: SolvedTimingPlan;
  durationFrames: number;
}): EntityInstance[] {
  const landmarkBindings = new Map((input.catalog.landmarkBindings ?? []).map(binding => [binding.landmarkType, binding.entityDefinitionId]));
  const effectBindings = new Map((input.catalog.effectBindings ?? []).map(binding => [binding.effectType, binding.entityDefinitionId]));
  const landmarks: EntityInstance[] = (input.effective.plan.landmarks ?? []).map(landmark => {
    const definitionId = landmarkBindings.get(landmark.landmarkType);
    if (definitionId === undefined) throw new Error(`No resolved landmark binding for ${landmark.landmarkType}`);
    return {
      id: landmark.id,
      definitionId,
      sceneId: landmark.sceneId,
      activeRange: {startFrame: 0, endFrame: input.durationFrames},
      initialOwner: {kind: 'world', environmentId: environmentForScene(input.effective, landmark.sceneId)},
    };
  });
  const scheduledActionIds = new Set(input.timing.shots.flatMap(shot => shot.actions.map(action => action.expandedActionId)));
  const effects: EntityInstance[] = input.preflight.expandedActions.filter(action => scheduledActionIds.has(action.id)).flatMap(action => {
    const cue = action.interaction?.effect;
    if (cue === undefined) return [];
    const definitionId = effectBindings.get(cue.effectType);
    if (definitionId === undefined) throw new Error(`No resolved effect binding for ${cue.effectType}`);
    return [{
      id: effectInstanceId(action.id), definitionId, sceneId: action.sceneId,
      activeRange: {startFrame: 0, endFrame: input.durationFrames},
      initialOwner: {kind: 'world' as const, environmentId: environmentForScene(input.effective, action.sceneId)},
    }];
  });
  return [...landmarks, ...effects];
}

function definitionIdForEntity(effective: EffectiveDirectorPlan, catalog: ResolvedAssetCatalog, entityId: string): string {
  const character = catalog.characterBindings.find(binding => binding.characterId === entityId);
  if (character !== undefined) return character.entityDefinitionId;
  const landmark = effective.plan.landmarks?.find(candidate => candidate.id === entityId);
  const binding = landmark === undefined ? undefined : catalog.landmarkBindings?.find(candidate => candidate.landmarkType === landmark.landmarkType);
  if (binding === undefined) throw new Error(`No resolved EntityDefinition for interaction target ${entityId}`);
  return binding.entityDefinitionId;
}

function targetGroundPoint(input: {
  effective: EffectiveDirectorPlan;
  catalog: ResolvedAssetCatalog;
  tracks: Timeline['entityTracks'];
  targetId: string;
  frame: number;
  anchorId?: string;
}): {u: number; v: number} {
  const track = input.tracks.find(candidate => candidate.entityId === input.targetId)?.groundPosition;
  if (track === undefined) throw new Error(`Interaction target ${input.targetId} has no ground track`);
  const base = evaluateGroundPointKeyframes(track, input.frame);
  if (input.anchorId === undefined) return base;
  const definitionId = definitionIdForEntity(input.effective, input.catalog, input.targetId);
  const definition = input.catalog.entityDefinitions.find(candidate => candidate.id === definitionId)!;
  const anchor = definition.interactionAnchors?.find(candidate => candidate.id === input.anchorId);
  if (anchor === undefined) throw new Error(`Interaction target ${input.targetId} has no anchor ${input.anchorId}`);
  return {u: clamp01(base.u + anchor.groundOffset.u), v: clamp01(base.v + anchor.groundOffset.v)};
}

function upsertGroundPoint(track: Timeline['entityTracks'][number], frame: number, value: {u: number; v: number}): void {
  if (track.groundPosition === undefined) throw new Error(`Interaction actor ${track.entityId} has no ground track`);
  const keyframe = {frame, value, easing: 'hold' as const};
  const index = track.groundPosition.findIndex(candidate => candidate.frame === frame);
  if (index === -1) track.groundPosition.push(keyframe);
  else track.groundPosition[index] = keyframe;
  track.groundPosition.sort((left, right) => left.frame - right.frame);
}

export function compileInteractionTimeline(input: {
  effective: EffectiveDirectorPlan;
  preflight: PreflightCompileResult;
  timing: SolvedTimingPlan;
  catalog: ResolvedAssetCatalog;
  baseTracks: Timeline['entityTracks'];
}): Pick<Timeline, 'entityTracks' | 'ownershipEvents' | 'visibilityEvents' | 'effectEvents' | 'markers'> {
  const entityTracks = structuredClone(input.baseTracks);
  const ownershipEvents: Timeline['ownershipEvents'] = [];
  const visibilityEvents: Timeline['visibilityEvents'] = [];
  const effectEvents: Timeline['effectEvents'] = [];
  const markers: Timeline['markers'] = [];
  for (const {solved, action} of solvedActions(input.preflight, input.timing)) {
    const interaction = action.interaction;
    if (interaction === undefined || action.targetId === undefined) continue;
    const contactPoint = targetGroundPoint({
      effective: input.effective, catalog: input.catalog, tracks: entityTracks,
      targetId: action.targetId, frame: solved.startFrame,
      ...(interaction.contact === undefined ? {} : {anchorId: interaction.contact.targetAnchorId}),
    });
    if (interaction.contact !== undefined) {
      const actorOffset = interaction.contact.actorGroundOffset ?? {u: 0, v: 0};
      const actorTrack = entityTracks.find(candidate => candidate.entityId === action.actorId);
      if (actorTrack === undefined) throw new Error(`Interaction actor ${action.actorId} has no EntityTrack`);
      upsertGroundPoint(actorTrack, solved.startFrame, {
        u: clamp01(contactPoint.u + actorOffset.u), v: clamp01(contactPoint.v + actorOffset.v),
      });
      markers.push({id: `marker.contact.${action.id}`, frame: solved.startFrame, type: 'interaction-contact', entityIds: [action.actorId, action.targetId]});
    }
    if (interaction.effect !== undefined) {
      const effectId = effectInstanceId(action.id);
      entityTracks.push({entityId: effectId, groundPosition: [{frame: 0, value: contactPoint, easing: 'hold'}]});
      if (solved.startFrame > 0) visibilityEvents.push({id: `visibility.${effectId}.hidden`, frame: 0, entityId: effectId, visible: false});
      visibilityEvents.push({id: `visibility.${effectId}.show`, frame: solved.startFrame, entityId: effectId, visible: true});
      const hideFrame = Math.min(input.timing.durationFrames - 1, solved.startFrame + interaction.effect.durationFrames);
      if (hideFrame > solved.startFrame) visibilityEvents.push({id: `visibility.${effectId}.hide`, frame: hideFrame, entityId: effectId, visible: false});
      effectEvents.push({
        id: `effect-event.${action.id}`, frame: solved.startFrame, effectType: interaction.effect.effectType,
        targetEntityId: action.targetId, durationFrames: interaction.effect.durationFrames,
      });
    }
    if (interaction.ownership !== undefined) {
      const frame = resolveOwnershipEventFrame(interaction.ownership.timing, solved);
      ownershipEvents.push({
        id: `ownership.${action.id}`, frame, type: 'attach', entityId: action.targetId,
        from: {kind: 'world', environmentId: environmentForScene(input.effective, action.sceneId)},
        to: {kind: 'entity', entityId: action.actorId, slot: interaction.ownership.ownerSlot},
        mode: 'baked', preserveWorldTransform: false,
        bakedBinding: {ownerEntityId: action.actorId, childEntityId: action.targetId, compositeSlotId: interaction.ownership.compositeSlotId},
      });
      markers.push({id: `marker.ownership.${action.id}`, frame, type: 'ownership-transfer', entityIds: [action.actorId, action.targetId]});
    }
  }
  const byFrameAndId = <T extends {id: string}>(left: T & {frame: number}, right: T & {frame: number}) => left.frame - right.frame || left.id.localeCompare(right.id);
  ownershipEvents.sort(byFrameAndId);
  visibilityEvents.sort(byFrameAndId);
  effectEvents.sort(byFrameAndId);
  markers.sort(byFrameAndId);
  return {entityTracks, ownershipEvents, visibilityEvents, effectEvents, markers};
}
