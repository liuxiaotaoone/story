import type {OwnerRef, SocketBinding, Timeline} from '@pose-clip/schemas';

export interface ResolvedOwnership {
  owner: OwnerRef;
  mode?: 'socket' | 'baked';
  socketBinding?: SocketBinding;
}

function sameOwner(left: OwnerRef, right: OwnerRef): boolean {
  return left.kind === right.kind && (left.kind === 'world'
    ? right.kind === 'world' && left.environmentId === right.environmentId
    : right.kind === 'entity' && left.entityId === right.entityId && left.slot === right.slot);
}

export function resolveOwner(
  timeline: Timeline,
  entityId: string,
  initialOwner: OwnerRef,
  frame: number,
): OwnerRef {
  return resolveOwnership(timeline, entityId, initialOwner, frame).owner;
}

export function resolveOwnership(
  timeline: Timeline,
  entityId: string,
  initialOwner: OwnerRef,
  frame: number,
): ResolvedOwnership {
  const events = timeline.ownershipEvents
    .filter((event) => event.entityId === entityId && event.frame <= frame)
    .sort((left, right) => left.frame - right.frame || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  let state: ResolvedOwnership = {owner: initialOwner};
  for (const event of events) {
    if (!sameOwner(state.owner, event.from)) throw new Error(`Ownership event ${event.id} has stale from owner`);
    state = event.type === 'attach'
      ? {
          owner: event.to,
          mode: event.mode,
          ...(event.socketBinding === undefined ? {} : {socketBinding: event.socketBinding}),
        }
      : {owner: event.to};
  }
  return state;
}

export function resolveVisibility(timeline: Timeline, entityId: string, frame: number): boolean {
  const event = timeline.visibilityEvents
    .filter((candidate) => candidate.entityId === entityId && candidate.frame <= frame)
    .sort((left, right) => left.frame - right.frame || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .at(-1);
  return event?.visible ?? true;
}
