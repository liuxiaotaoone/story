import {
  RenderStateSchema,
  compareSpriteRenderOrder,
  type EntityDefinition,
  type Point,
  type PoseAnchors,
  type RenderState,
  type SpriteRenderState,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import {resolveSocketAttachment} from '../ownership/attachment-resolver.js';
import {resolveOwnership, resolveVisibility} from '../ownership/ownership-resolver.js';
import {worldPointForLocalAnchor} from '../pose/anchor-placement.js';
import {resolveGroundLock} from '../pose/ground-lock.js';
import {resolvePoseClipFrame} from '../pose/pose-clip-evaluator.js';
import {resolvePoseSelections} from '../pose/pose-transition.js';
import {projectGround} from '../spatial/ground-projection.js';
import {containsFrame} from '../timeline/frame-range.js';
import {resolveShot} from '../timeline/shot-resolver.js';
import {resolveCameraTrack, resolveEntityTrack} from '../timeline/track-resolver.js';
import type {PreparedRenderPlan} from '../prepared/prepare-render-plan.js';

interface EntitySpriteContext {
  definition: EntityDefinition;
  sprite: SpriteRenderState;
  asset: VisualAssetRecord;
  anchors: PoseAnchors;
}

function visualAsset(prepared: PreparedRenderPlan, assetId: string): VisualAssetRecord {
  const asset = prepared.assetById.get(assetId);
  if (asset === undefined || !('width' in asset) || !('height' in asset) || !('alphaMode' in asset)) {
    throw new Error(`Missing visual asset ${assetId}`);
  }
  return asset;
}

function poseAnchor(anchors: PoseAnchors, name: string): Point | undefined {
  if (name === 'foot') return anchors.foot;
  if (name === 'center') return anchors.center;
  if (name === 'leftFoot') return anchors.leftFoot;
  if (name === 'rightFoot') return anchors.rightFoot;
  if (name === 'leftHand') return anchors.leftHand;
  if (name === 'rightHand') return anchors.rightHand;
  if (name === 'head') return anchors.head;
  return anchors.auxiliary?.[name];
}

function primaryContext(contexts: readonly EntitySpriteContext[]): EntitySpriteContext | undefined {
  return contexts.find((context) => context.sprite.poseTransition?.role === 'to' && context.sprite.visible)
    ?? contexts.filter((context) => context.sprite.visible)
      .sort((left, right) => (right.sprite.poseTransition?.weight ?? 1) - (left.sprite.poseTransition?.weight ?? 1))[0]
    ?? contexts[0];
}

function stableEntityKey(entityId: string, role: 'from' | 'to' | 'main', assetId: string): string {
  const order = role === 'from' ? '0' : role === 'to' ? '1' : '0';
  return `entity:${entityId}:${order}:${role}:${assetId}`;
}

export function evaluateFrame(prepared: PreparedRenderPlan, frame: number): RenderState {
  if (prepared.kind !== 'prepared-render-plan-v1') throw new TypeError('evaluateFrame requires a PreparedRenderPlan');
  const plan = prepared.plan;
  const timeline = plan.timeline;
  const shot = resolveShot(timeline, frame);
  const environment = prepared.environmentById.get(shot.environmentId);
  if (environment === undefined) throw new Error(`Missing environment ${shot.environmentId}`);
  const camera = resolveCameraTrack(prepared.cameraTrackByShotId.get(shot.id), frame);
  const sprites: SpriteRenderState[] = [];

  for (const layer of environment.layers) {
    visualAsset(prepared, layer.assetId);
    sprites.push({
      renderId: `environment:${environment.id}:${layer.id}`,
      assetId: layer.assetId,
      transform: layer.transform,
      anchor: {x: 0, y: 0},
      renderLayer: layer.renderLayer,
      zIndex: layer.zIndex,
      depth: 0,
      stableSortKey: `environment:${environment.id}:${layer.id}`,
      visible: true,
      owner: {kind: 'world', environmentId: environment.id},
      cameraSpace: {kind: 'world', influence: layer.parallaxFactor},
    });
  }

  const contexts = new Map<string, EntitySpriteContext[]>();
  const ownershipByEntity = new Map<string, ReturnType<typeof resolveOwnership>>();

  for (const instance of plan.instances) {
    if (instance.sceneId !== shot.sceneId || !containsFrame(instance.activeRange, frame)) continue;
    if (!resolveVisibility(timeline, instance.id, frame)) continue;
    const definition = prepared.entityDefinitionById.get(instance.definitionId);
    if (definition === undefined) throw new Error(`Missing definition ${instance.definitionId}`);
    const ownership = resolveOwnership(timeline, instance.id, instance.initialOwner, frame);
    ownershipByEntity.set(instance.id, ownership);
    if (ownership.mode === 'baked') continue;
    if (ownership.owner.kind === 'world' && ownership.owner.environmentId !== environment.id) continue;

    const track = resolveEntityTrack(
      prepared.entityTrackByEntityId.get(instance.id),
      frame,
    );
    const groundProjection = track.groundPosition === undefined
      ? undefined
      : projectGround(environment, track.groundPosition);
    const worldPosition = groundProjection?.worldFootPosition
      ?? track.worldPosition
      ?? projectGround(environment, {u: 0.5, v: 0.5}).worldFootPosition;
    const perspectiveScale = ownership.owner.kind === 'world'
      ? groundProjection?.perspectiveScale ?? 1
      : 1;
    const baseScale = {
      x: track.scale.x * perspectiveScale,
      y: track.scale.y * perspectiveScale,
    };
    const depth = groundProjection?.depth ?? 0.5;
    const selections = resolvePoseSelections(timeline, instance.id, definition.defaultPoseClipId, frame);
    const entityContexts: EntitySpriteContext[] = [];

    for (const selection of selections) {
      const clip = prepared.poseClipById.get(selection.poseClipId);
      if (clip === undefined) throw new Error(`Missing PoseClip ${selection.poseClipId}`);
      const resolved = resolvePoseClipFrame(
        clip,
        frame,
        selection.startFrame,
        selection.playbackRate,
        selection.clipStartOffset,
      );
      const asset = visualAsset(prepared, resolved.frame.assetId);
      const lock = resolveGroundLock(
        prepared,
        instance,
        selection,
        frame,
        {width: asset.width, height: asset.height},
        baseScale,
      );
      const role = selection.transition?.role ?? 'main';
      const sprite: SpriteRenderState = {
        renderId: `${instance.id}:${role}:${asset.id}`,
        entityId: instance.id,
        assetId: asset.id,
        transform: {
          position: {
            x: worldPosition.x + lock.correction.x,
            y: worldPosition.y + lock.correction.y,
          },
          scale: baseScale,
          rotation: track.rotation,
          opacity: track.opacity * selection.transitionWeight,
        },
        anchor: lock.anchor,
        renderLayer: 'characters',
        zIndex: 0,
        depth,
        stableSortKey: stableEntityKey(instance.id, role, asset.id),
        visible: selection.transitionWeight > 0 && track.opacity > 0,
        owner: ownership.owner,
        cameraSpace: {kind: 'world', influence: 1},
        ...(selection.transition === undefined ? {} : {poseTransition: selection.transition}),
      };
      entityContexts.push({definition, sprite, asset, anchors: resolved.frame.anchors});
    }
    contexts.set(instance.id, entityContexts);
  }

  for (const [entityId, entityContexts] of contexts) {
    const ownership = ownershipByEntity.get(entityId);
    if (ownership?.owner.kind !== 'entity') {
      sprites.push(...entityContexts.map(({sprite}) => sprite));
      continue;
    }
    if (ownership.mode !== 'socket' || ownership.socketBinding === undefined) continue;
    const entityOwner = ownership.owner;
    const ownerContexts = contexts.get(entityOwner.entityId);
    const ownerContext = ownerContexts === undefined ? undefined : primaryContext(ownerContexts);
    if (ownerContext === undefined) throw new Error(`Socket owner ${entityOwner.entityId} is not renderable`);
    const slot = ownerContext.definition.attachmentSlots.find((candidate) => candidate.id === entityOwner.slot);
    if (slot === undefined) throw new Error(`Missing attachment slot ${entityOwner.slot}`);
    const ownerLocalAnchor = poseAnchor(ownerContext.anchors, slot.ownerAnchor);
    if (ownerLocalAnchor === undefined) throw new Error(`Owner pose has no anchor ${slot.ownerAnchor}`);
    const ownerAnchorWorld = worldPointForLocalAnchor(
      ownerContext.sprite.transform.position,
      ownerContext.sprite.anchor,
      ownerLocalAnchor,
      {width: ownerContext.asset.width, height: ownerContext.asset.height},
      ownerContext.sprite.transform.scale,
      ownerContext.sprite.transform.rotation,
    );

    for (const context of entityContexts) {
      const childAnchor = context.asset.attachmentAnchors?.find(
        (candidate) => candidate.id === ownership.socketBinding?.attachmentAnchorId,
      );
      if (childAnchor === undefined) throw new Error(`Child asset has no attachment anchor ${ownership.socketBinding.attachmentAnchorId}`);
      const attachment = resolveSocketAttachment({
        ownerAnchorWorld,
        ownerRotation: ownerContext.sprite.transform.rotation,
        ownerScale: ownerContext.sprite.transform.scale,
        childBaseScale: context.sprite.transform.scale,
        binding: ownership.socketBinding,
      });
      context.sprite.transform.position = attachment.position;
      context.sprite.transform.rotation = attachment.rotation;
      context.sprite.transform.scale = attachment.scale;
      context.sprite.anchor = childAnchor.point;
      context.sprite.depth = ownerContext.sprite.depth;
      context.sprite.zIndex = ownerContext.sprite.zIndex + 1;
      sprites.push(context.sprite);
    }
  }

  sprites.sort(compareSpriteRenderOrder);
  const effects = timeline.effectEvents
    .filter((event) => frame >= event.frame && frame < event.frame + (event.durationFrames ?? 1))
    .map((event) => ({
      effectId: event.id,
      effectType: event.effectType,
      ...(event.assetId === undefined ? {} : {assetId: event.assetId}),
      progress: (frame - event.frame) / (event.durationFrames ?? 1),
      ...(event.parameters === undefined ? {} : {parameters: event.parameters}),
    }));
  const subtitleCue = timeline.subtitles.find((cue) => containsFrame(cue.range, frame));
  const state: RenderState = {
    frame,
    shotId: shot.id,
    environmentId: environment.id,
    camera,
    sprites,
    effects,
    ...(subtitleCue === undefined ? {} : {
      subtitle: {cueId: subtitleCue.id, text: subtitleCue.text, styleId: subtitleCue.styleId, opacity: 1},
    }),
  };
  return RenderStateSchema.parse(state);
}

export const evaluate = evaluateFrame;
