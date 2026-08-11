import type {z} from 'zod';
import type {OwnerRef} from './attachment.js';
import {RenderPlanSchema, type RenderPlan} from './render.js';
import {validateOwnershipTimeline} from './ownership-integrity.js';

export interface RenderPlanIntegrityIssue {
  code: string;
  message: string;
  path: string;
}

export interface RenderPlanIntegrityResult {
  valid: boolean;
  issues: RenderPlanIntegrityIssue[];
  plan?: RenderPlan;
}

function schemaIssues(issues: z.core.$ZodIssue[]): RenderPlanIntegrityIssue[] {
  return issues.map((issue) => ({
    code: 'SCHEMA_INVALID',
    message: issue.message,
    path: issue.path.map(String).join('.'),
  }));
}

export function validateRenderPlanIntegrity(input: unknown): RenderPlanIntegrityResult {
  const parsed = RenderPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {valid: false, issues: schemaIssues(parsed.error.issues)};
  }

  const plan = parsed.data;
  const issues: RenderPlanIntegrityIssue[] = [];
  const add = (code: string, message: string, path: string) => issues.push({code, message, path});
  const assets = new Map(plan.assets.assets.map((asset) => [asset.id, asset]));
  const environments = new Map(plan.environments.map((environment) => [environment.id, environment]));
  const entities = new Map(plan.entities.map((entity) => [entity.id, entity]));
  const instances = new Map(plan.instances.map((instance) => [instance.id, instance]));
  const poseClips = new Map(plan.poseClips.map((clip) => [clip.id, clip]));
  const shots = new Map(plan.timeline.shots.map((shot) => [shot.id, shot]));

  function requireUnique<T extends {id: string}>(items: readonly T[], kind: string, path: string): void {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) add('DUPLICATE_ID', `Duplicate ${kind} id: ${item.id}`, `${path}.${index}.id`);
      seen.add(item.id);
    }
  }

  requireUnique(plan.environments, 'environment', 'environments');
  requireUnique(plan.entities, 'entity definition', 'entities');
  requireUnique(plan.instances, 'entity instance', 'instances');
  requireUnique(plan.poseClips, 'pose clip', 'poseClips');
  requireUnique(plan.timeline.shots, 'shot', 'timeline.shots');

  for (const [environmentIndex, environment] of plan.environments.entries()) {
    for (const [layerIndex, layer] of environment.layers.entries()) {
      const asset = assets.get(layer.assetId);
      if (asset === undefined) {
        add('MISSING_ASSET', `Environment layer references missing asset ${layer.assetId}`, `environments.${environmentIndex}.layers.${layerIndex}.assetId`);
      } else if (asset.kind !== 'environment-layer' && asset.kind !== 'effect') {
        add('INVALID_ASSET_KIND', `Environment layer asset ${asset.id} has kind ${asset.kind}`, `environments.${environmentIndex}.layers.${layerIndex}.assetId`);
      }
    }
  }

  for (const [entityIndex, entity] of plan.entities.entries()) {
    for (const [clipIndex, clipId] of entity.poseClipIds.entries()) {
      const clip = poseClips.get(clipId);
      if (clip === undefined) {
        add('MISSING_POSE_CLIP', `Entity references missing pose clip ${clipId}`, `entities.${entityIndex}.poseClipIds.${clipIndex}`);
      } else if (clip.entityType !== entity.entityType) {
        add('POSE_ENTITY_TYPE_MISMATCH', `Pose clip ${clipId} belongs to ${clip.entityType}`, `entities.${entityIndex}.poseClipIds.${clipIndex}`);
      }
    }
  }

  for (const [clipIndex, clip] of plan.poseClips.entries()) {
    for (const [frameIndex, frame] of clip.frames.entries()) {
      const asset = assets.get(frame.assetId);
      if (asset === undefined) {
        add('MISSING_ASSET', `Pose frame references missing asset ${frame.assetId}`, `poseClips.${clipIndex}.frames.${frameIndex}.assetId`);
      } else if (asset.kind !== 'character-frame' && asset.kind !== 'animal-frame' && asset.kind !== 'prop') {
        add('INVALID_ASSET_KIND', `Pose frame asset ${asset.id} is not a renderable entity frame`, `poseClips.${clipIndex}.frames.${frameIndex}.assetId`);
      }
    }
  }

  function validateOwner(owner: OwnerRef, path: string): void {
    if (owner.kind === 'world') {
      if (!environments.has(owner.environmentId)) add('MISSING_ENVIRONMENT', `Missing owner environment ${owner.environmentId}`, path);
      return;
    }
    const ownerInstance = instances.get(owner.entityId);
    if (ownerInstance === undefined) {
      add('MISSING_ENTITY_INSTANCE', `Missing owner entity ${owner.entityId}`, path);
      return;
    }
    const ownerDefinition = entities.get(ownerInstance.definitionId);
    if (!ownerDefinition?.attachmentSlots.some((slot) => slot.id === owner.slot)) {
      add('MISSING_ATTACHMENT_SLOT', `Owner ${owner.entityId} has no slot ${owner.slot}`, path);
    }
  }

  function activeClipIds(entityId: string, startFrame: number, endFrame: number, defaultClipId: string): string[] {
    const before = plan.timeline.poseEvents
      .filter((event) => event.entityId === entityId && event.frame <= startFrame)
      .sort((left, right) => right.frame - left.frame || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0))[0];
    return [...new Set([
      before?.poseClipId ?? defaultClipId,
      ...plan.timeline.poseEvents
        .filter((event) => event.entityId === entityId && event.frame > startFrame && event.frame < endFrame)
        .map((event) => event.poseClipId),
    ])];
  }

  function poseFrameHasAnchor(frame: RenderPlan['poseClips'][number]['frames'][number], anchor: string): boolean {
    if (anchor === 'foot' || anchor === 'center') return true;
    if (anchor === 'leftFoot') return frame.anchors.leftFoot !== undefined;
    if (anchor === 'rightFoot') return frame.anchors.rightFoot !== undefined;
    if (anchor === 'leftHand') return frame.anchors.leftHand !== undefined;
    if (anchor === 'rightHand') return frame.anchors.rightHand !== undefined;
    if (anchor === 'head') return frame.anchors.head !== undefined;
    return frame.anchors.auxiliary?.[anchor] !== undefined;
  }

  for (const [instanceIndex, instance] of plan.instances.entries()) {
    if (!entities.has(instance.definitionId)) add('MISSING_ENTITY_DEFINITION', `Missing entity definition ${instance.definitionId}`, `instances.${instanceIndex}.definitionId`);
    if (!plan.timeline.shots.some((shot) => shot.sceneId === instance.sceneId)) add('MISSING_SCENE', `No shot references instance scene ${instance.sceneId}`, `instances.${instanceIndex}.sceneId`);
    validateOwner(instance.initialOwner, `instances.${instanceIndex}.initialOwner`);
  }

  for (const [shotIndex, shot] of plan.timeline.shots.entries()) {
    if (!environments.has(shot.environmentId)) add('MISSING_ENVIRONMENT', `Shot references missing environment ${shot.environmentId}`, `timeline.shots.${shotIndex}.environmentId`);
    if (shot.focusEntityId !== undefined && !instances.has(shot.focusEntityId)) add('MISSING_ENTITY_INSTANCE', `Shot focus references missing entity ${shot.focusEntityId}`, `timeline.shots.${shotIndex}.focusEntityId`);
    const cameraTrack = plan.timeline.cameraTracks.find((track) => track.shotId === shot.id);
    if (cameraTrack === undefined) {
      add('MISSING_CAMERA_TRACK', `Shot ${shot.id} requires an explicit CameraTrack`, `timeline.shots.${shotIndex}.id`);
    } else if (cameraTrack.position[0]?.frame !== shot.range.startFrame || cameraTrack.zoom[0]?.frame !== shot.range.startFrame
      || (cameraTrack.rotation !== undefined && cameraTrack.rotation[0]?.frame !== shot.range.startFrame)) {
      add('CAMERA_TRACK_START_MISMATCH', `CameraTrack ${shot.id} must explicitly start at frame ${shot.range.startFrame}`, `timeline.cameraTracks.${plan.timeline.cameraTracks.indexOf(cameraTrack)}`);
    }
  }
  for (const [index, track] of plan.timeline.entityTracks.entries()) {
    if (!instances.has(track.entityId)) add('MISSING_ENTITY_INSTANCE', `Track references missing entity ${track.entityId}`, `timeline.entityTracks.${index}.entityId`);
  }
  for (const [index, track] of plan.timeline.cameraTracks.entries()) {
    if (!shots.has(track.shotId)) add('MISSING_SHOT', `Camera track references missing shot ${track.shotId}`, `timeline.cameraTracks.${index}.shotId`);
  }
  for (const [index, event] of plan.timeline.poseEvents.entries()) {
    const instance = instances.get(event.entityId);
    const definition = instance === undefined ? undefined : entities.get(instance.definitionId);
    if (instance === undefined) add('MISSING_ENTITY_INSTANCE', `Pose event references missing entity ${event.entityId}`, `timeline.poseEvents.${index}.entityId`);
    if (!poseClips.has(event.poseClipId)) add('MISSING_POSE_CLIP', `Pose event references missing clip ${event.poseClipId}`, `timeline.poseEvents.${index}.poseClipId`);
    else if (definition !== undefined && !definition.poseClipIds.includes(event.poseClipId)) add('POSE_NOT_ALLOWED', `Pose ${event.poseClipId} is not registered for ${event.entityId}`, `timeline.poseEvents.${index}.poseClipId`);
  }
  for (const [index, transition] of plan.timeline.poseTransitions.entries()) {
    const instance = instances.get(transition.entityId);
    const definition = instance === undefined ? undefined : entities.get(instance.definitionId);
    if (instance === undefined) add('MISSING_ENTITY_INSTANCE', `Pose transition references missing entity ${transition.entityId}`, `timeline.poseTransitions.${index}.entityId`);
    if (!poseClips.has(transition.fromPoseClipId)) add('MISSING_POSE_CLIP', `Missing from pose ${transition.fromPoseClipId}`, `timeline.poseTransitions.${index}.fromPoseClipId`);
    if (!poseClips.has(transition.toPoseClipId)) add('MISSING_POSE_CLIP', `Missing to pose ${transition.toPoseClipId}`, `timeline.poseTransitions.${index}.toPoseClipId`);
    const previousPoseEvent = plan.timeline.poseEvents
      .filter((event) => event.entityId === transition.entityId && event.frame < transition.startFrame)
      .sort((left, right) => right.frame - left.frame || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0))[0];
    const activePoseClipId = previousPoseEvent?.poseClipId ?? definition?.defaultPoseClipId;
    if (activePoseClipId !== undefined && activePoseClipId !== transition.fromPoseClipId) {
      add('POSE_TRANSITION_FROM_MISMATCH', `Transition ${transition.id} expects ${transition.fromPoseClipId}, but ${activePoseClipId} is active before frame ${transition.startFrame}`, `timeline.poseTransitions.${index}.fromPoseClipId`);
    }
  }
  for (const [index, event] of plan.timeline.ownershipEvents.entries()) {
    if (!instances.has(event.entityId)) add('MISSING_ENTITY_INSTANCE', `Ownership event references missing entity ${event.entityId}`, `timeline.ownershipEvents.${index}.entityId`);
    validateOwner(event.from, `timeline.ownershipEvents.${index}.from`);
    validateOwner(event.to, `timeline.ownershipEvents.${index}.to`);
    if (event.mode === 'baked') {
      const activeCrossfade = plan.timeline.poseTransitions.find((transition) =>
        transition.mode === 'crossfade'
        && event.frame >= transition.startFrame
        && event.frame < transition.startFrame + transition.durationFrames
        && (transition.entityId === event.entityId
          || (event.from.kind === 'entity' && transition.entityId === event.from.entityId)
          || (event.to.kind === 'entity' && transition.entityId === event.to.entityId)));
      if (activeCrossfade !== undefined) {
        add('BAKED_DURING_CROSSFADE', `Baked ownership event ${event.id} occurs during ${activeCrossfade.id}`, `timeline.ownershipEvents.${index}.frame`);
      }
    }
    if (event.type === 'attach' && event.mode === 'socket' && event.socketBinding !== undefined) {
      const socketBinding = event.socketBinding;
      const childInstance = instances.get(event.entityId);
      const childDefinition = childInstance === undefined ? undefined : entities.get(childInstance.definitionId);
      const detachFrame = plan.timeline.ownershipEvents
        .filter((candidate) => candidate.entityId === event.entityId && candidate.frame > event.frame)
        .sort((left, right) => left.frame - right.frame)[0]?.frame ?? plan.timeline.durationFrames;
      const childClipIds = childDefinition === undefined ? [] : activeClipIds(event.entityId, event.frame, detachFrame, childDefinition.defaultPoseClipId);
      const childAssets = childClipIds.flatMap((clipId) => poseClips.get(clipId)?.frames.map((frame) => assets.get(frame.assetId)) ?? []);
      const allChildFramesHaveAnchor = childAssets.length > 0 && childAssets.every((asset) => asset !== undefined
        && 'attachmentAnchors' in asset
        && asset.attachmentAnchors?.some((anchor) => anchor.id === socketBinding.attachmentAnchorId));
      if (!allChildFramesHaveAnchor) add('MISSING_ATTACHMENT_ANCHOR', `Every active child pose frame must define anchor ${socketBinding.attachmentAnchorId}`, `timeline.ownershipEvents.${index}.socketBinding.attachmentAnchorId`);
      if (event.to.kind === 'entity') {
        const entityOwner = event.to;
        const ownerInstance = instances.get(entityOwner.entityId);
        const ownerDefinition = ownerInstance === undefined ? undefined : entities.get(ownerInstance.definitionId);
        const slot = ownerDefinition?.attachmentSlots.find((candidate) => candidate.id === entityOwner.slot);
        const ownerClipIds = ownerDefinition === undefined ? [] : activeClipIds(entityOwner.entityId, event.frame, detachFrame, ownerDefinition.defaultPoseClipId);
        const allOwnerFramesHaveAnchor = slot !== undefined && ownerClipIds.every((clipId) =>
          poseClips.get(clipId)?.frames.every((frame) => poseFrameHasAnchor(frame, slot.ownerAnchor)) === true);
        if (!allOwnerFramesHaveAnchor) add('MISSING_OWNER_POSE_ANCHOR', `Every active owner pose frame must define slot anchor ${slot?.ownerAnchor ?? entityOwner.slot}`, `timeline.ownershipEvents.${index}.to.slot`);
      }
    }
  }
  for (const [index, cue] of plan.timeline.narration.entries()) {
    if (assets.get(cue.assetId)?.kind !== 'audio') add('INVALID_AUDIO_ASSET', `Narration asset ${cue.assetId} is missing or not audio`, `timeline.narration.${index}.assetId`);
  }
  for (const [index, cue] of plan.timeline.sfx.entries()) {
    if (assets.get(cue.assetId)?.kind !== 'audio') add('INVALID_AUDIO_ASSET', `SFX asset ${cue.assetId} is missing or not audio`, `timeline.sfx.${index}.assetId`);
  }
  for (const [index, event] of plan.timeline.effectEvents.entries()) {
    if (event.assetId !== undefined && !assets.has(event.assetId)) add('MISSING_ASSET', `Effect references missing asset ${event.assetId}`, `timeline.effectEvents.${index}.assetId`);
  }
  for (const [index, transition] of plan.timeline.transitions.entries()) {
    if (!shots.has(transition.fromShotId)) add('MISSING_SHOT', `Transition references missing from shot ${transition.fromShotId}`, `timeline.transitions.${index}.fromShotId`);
    if (!shots.has(transition.toShotId)) add('MISSING_SHOT', `Transition references missing to shot ${transition.toShotId}`, `timeline.transitions.${index}.toShotId`);
  }

  issues.push(...validateOwnershipTimeline(plan));

  return issues.length === 0 ? {valid: true, issues, plan} : {valid: false, issues, plan};
}

export function assertRenderPlanIntegrity(input: unknown): RenderPlan {
  const result = validateRenderPlanIntegrity(input);
  if (!result.valid || result.plan === undefined) {
    const message = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    throw new Error(`RenderPlan integrity validation failed:\n${message}`);
  }
  return result.plan;
}
