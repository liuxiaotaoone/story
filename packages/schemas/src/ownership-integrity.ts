import type {OwnerRef} from './attachment.js';
import type {RenderPlan} from './render.js';

export interface OwnershipIntegrityIssue {
  code: string;
  message: string;
  path: string;
}

function sameOwner(left: OwnerRef, right: OwnerRef): boolean {
  return left.kind === right.kind && (left.kind === 'world'
    ? right.kind === 'world' && left.environmentId === right.environmentId
    : right.kind === 'entity' && left.entityId === right.entityId && left.slot === right.slot);
}

export function validateOwnershipTimeline(plan: RenderPlan): OwnershipIntegrityIssue[] {
  const issues: OwnershipIntegrityIssue[] = [];
  const add = (code: string, message: string, path: string) => issues.push({code, message, path});
  const instances = new Map(plan.instances.map((instance) => [instance.id, instance]));
  const definitions = new Map(plan.entities.map((definition) => [definition.id, definition]));
  const clips = new Map(plan.poseClips.map((clip) => [clip.id, clip]));
  const owners = new Map<string, OwnerRef>(plan.instances.map((instance) => [instance.id, instance.initialOwner]));
  const indexedEvents = plan.timeline.ownershipEvents.map((event, index) => ({event, index}));

  const duplicateKeys = new Set<string>();
  for (const {event, index} of indexedEvents) {
    const key = `${event.entityId}\u0000${event.frame}`;
    if (duplicateKeys.has(key)) {
      add('DUPLICATE_OWNERSHIP_EVENT', `Duplicate ownership event for ${event.entityId} at frame ${event.frame}`, `timeline.ownershipEvents.${index}`);
    }
    duplicateKeys.add(key);
  }

  function validateGraph(frame: number): void {
    for (const entityId of owners.keys()) {
      const visited = new Set<string>([entityId]);
      let cursor = entityId;
      let depth = 0;
      for (;;) {
        const owner = owners.get(cursor);
        if (owner?.kind !== 'entity') break;
        depth += 1;
        if (visited.has(owner.entityId)) {
          add('OWNERSHIP_CYCLE', `Ownership cycle involving ${owner.entityId} at frame ${frame}`, 'timeline.ownershipEvents');
          break;
        }
        visited.add(owner.entityId);
        cursor = owner.entityId;
      }
      if (depth > 1) add('OWNERSHIP_DEPTH_EXCEEDED', `Ownership depth for ${entityId} exceeds one at frame ${frame}`, 'timeline.ownershipEvents');
    }
  }

  validateGraph(0);
  const frames = [...new Set(indexedEvents.map(({event}) => event.frame))].sort((a, b) => a - b);
  for (const frame of frames) {
    const batch = indexedEvents.filter(({event}) => event.frame === frame);
    for (const {event, index} of batch) {
      const path = `timeline.ownershipEvents.${index}`;
      const current = owners.get(event.entityId);
      if (current !== undefined && !sameOwner(current, event.from)) {
        add('STALE_OWNERSHIP_FROM', `Ownership event ${event.id} does not continue the owner chain`, `${path}.from`);
      }
      if (event.to.kind === 'entity' && event.to.entityId === event.entityId) {
        add('SELF_ATTACHMENT', `Entity ${event.entityId} cannot own itself`, `${path}.to`);
      }
      if (event.type === 'detach' && event.to.kind !== 'world') {
        add('DETACH_NOT_WORLD', 'Detach must return ownership to world', `${path}.to`);
      }
      if (event.type === 'attach' && event.mode === 'baked' && event.bakedBinding !== undefined && event.to.kind === 'entity') {
        const ownerEntityId = event.to.entityId;
        const bakedBinding = event.bakedBinding;
        const ownerInstance = instances.get(ownerEntityId);
        const ownerDefinition = ownerInstance === undefined ? undefined : definitions.get(ownerInstance.definitionId);
        const childInstance = instances.get(event.entityId);
        const childDefinition = childInstance === undefined ? undefined : definitions.get(childInstance.definitionId);
        const activePoseEvent = plan.timeline.poseEvents
          .filter((poseEvent) => poseEvent.entityId === ownerEntityId && poseEvent.frame <= frame)
          .sort((left, right) => right.frame - left.frame || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0))[0];
        const detachFrame = plan.timeline.ownershipEvents
          .filter((candidate) => candidate.entityId === event.entityId && candidate.frame > frame)
          .sort((left, right) => left.frame - right.frame)[0]?.frame ?? plan.timeline.durationFrames;
        const activeClipIds = [...new Set([
          activePoseEvent?.poseClipId ?? ownerDefinition?.defaultPoseClipId,
          ...plan.timeline.poseEvents
            .filter((poseEvent) => poseEvent.entityId === ownerEntityId && poseEvent.frame > frame && poseEvent.frame < detachFrame)
            .map((poseEvent) => poseEvent.poseClipId),
        ].filter((clipId): clipId is string => clipId !== undefined))];
        for (const clipId of activeClipIds) {
          const compositeSlot = clips.get(clipId)?.compositeSlots?.find((slot) => slot.id === bakedBinding.compositeSlotId);
          if (compositeSlot === undefined) {
            add('MISSING_COMPOSITE_SLOT', `Active owner pose ${clipId} has no composite slot ${bakedBinding.compositeSlotId}`, `${path}.bakedBinding.compositeSlotId`);
          } else if (childDefinition !== undefined && compositeSlot.entityType !== childDefinition.entityType) {
            add('COMPOSITE_ENTITY_TYPE_MISMATCH', `Composite slot expects ${compositeSlot.entityType}, received ${childDefinition.entityType}`, `${path}.bakedBinding.compositeSlotId`);
          }
        }
      }
    }
    for (const {event} of batch) owners.set(event.entityId, event.to);
    validateGraph(frame);
  }
  return issues;
}
