import {
  assertRenderPlanIntegrity,
  type AssetRecord,
  type EntityDefinition,
  type EntityInstance,
  type EnvironmentDefinition,
  type PoseClip,
  type RenderPlan,
  type Timeline,
} from '@pose-clip/schemas';

type EntityTrack = Timeline['entityTracks'][number];
type CameraTrack = Timeline['cameraTracks'][number];

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #source: Map<K, V>;
  constructor(entries: Iterable<readonly [K, V]>) {
    this.#source = new Map(entries);
    Object.freeze(this);
  }
  get size(): number { return this.#source.size; }
  get(key: K): V | undefined { return this.#source.get(key); }
  has(key: K): boolean { return this.#source.has(key); }
  entries(): MapIterator<[K, V]> { return this.#source.entries(); }
  keys(): MapIterator<K> { return this.#source.keys(); }
  values(): MapIterator<V> { return this.#source.values(); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#source) callbackfn.call(thisArg, value, key, this);
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#source[Symbol.iterator](); }
  get [Symbol.toStringTag](): string { return 'ImmutableMapView'; }
}

export interface PreparedRenderPlan {
  readonly kind: 'prepared-render-plan-v1';
  readonly plan: Readonly<RenderPlan>;
  readonly assetById: ReadonlyMap<string, AssetRecord>;
  readonly environmentById: ReadonlyMap<string, EnvironmentDefinition>;
  readonly entityDefinitionById: ReadonlyMap<string, EntityDefinition>;
  readonly entityInstanceById: ReadonlyMap<string, EntityInstance>;
  readonly poseClipById: ReadonlyMap<string, PoseClip>;
  readonly entityTrackByEntityId: ReadonlyMap<string, EntityTrack>;
  readonly cameraTrackByShotId: ReadonlyMap<string, CameraTrack>;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function prepareRenderPlan(input: unknown): PreparedRenderPlan {
  const plan = deepFreeze(assertRenderPlanIntegrity(input));
  const prepared: PreparedRenderPlan = {
    kind: 'prepared-render-plan-v1',
    plan,
    assetById: new ImmutableMapView(plan.assets.assets.map((asset) => [asset.id, asset] as const)),
    environmentById: new ImmutableMapView(plan.environments.map((environment) => [environment.id, environment] as const)),
    entityDefinitionById: new ImmutableMapView(plan.entities.map((definition) => [definition.id, definition] as const)),
    entityInstanceById: new ImmutableMapView(plan.instances.map((instance) => [instance.id, instance] as const)),
    poseClipById: new ImmutableMapView(plan.poseClips.map((clip) => [clip.id, clip] as const)),
    entityTrackByEntityId: new ImmutableMapView(plan.timeline.entityTracks.map((track) => [track.entityId, track] as const)),
    cameraTrackByShotId: new ImmutableMapView(plan.timeline.cameraTracks.map((track) => [track.shotId, track] as const)),
  };
  return Object.freeze(prepared);
}
