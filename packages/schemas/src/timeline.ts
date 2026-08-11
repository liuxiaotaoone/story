import {z} from 'zod';
import {OwnershipEventSchema} from './attachment.js';
import {
  FiniteNumberSchema,
  FrameRangeSchema,
  FrameSchema,
  IdSchema,
  PointSchema,
  SemverSchema,
} from './common.js';
import {GroundPointSchema} from './environment.js';

export const EasingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']);

function keyframeSchema<T extends z.ZodType>(value: T) {
  return z.object({
    frame: FrameSchema,
    value,
    easing: EasingSchema,
  }).strict();
}

export const PointKeyframeSchema = keyframeSchema(PointSchema);
export const GroundPointKeyframeSchema = keyframeSchema(GroundPointSchema);
export const NumberKeyframeSchema = keyframeSchema(FiniteNumberSchema);
export const PositivePointKeyframeSchema = keyframeSchema(z.object({
  x: FiniteNumberSchema.positive(),
  y: FiniteNumberSchema.positive(),
}).strict());
export const PositiveNumberKeyframeSchema = keyframeSchema(FiniteNumberSchema.positive());
export const OpacityKeyframeSchema = keyframeSchema(FiniteNumberSchema.min(0).max(1));

type Framed = {frame: number};

export function assertStrictFrames<T extends Framed>(keyframes: readonly T[]): void {
  for (let index = 1; index < keyframes.length; index += 1) {
    const current = keyframes[index];
    const previous = keyframes[index - 1];
    if (current === undefined || previous === undefined) continue;
    if (current.frame <= previous.frame) {
      throw new Error('Keyframes must be strictly increasing');
    }
  }
}

function addStrictFrameIssue(
  keyframes: readonly Framed[] | undefined,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  if (keyframes === undefined) return;
  for (let index = 1; index < keyframes.length; index += 1) {
    const current = keyframes[index];
    const previous = keyframes[index - 1];
    if (current !== undefined && previous !== undefined && current.frame <= previous.frame) {
      context.addIssue({
        code: 'custom',
        message: 'Keyframes must be strictly increasing with no duplicate frames',
        path: [...path, index, 'frame'],
      });
    }
  }
}

export const ShotSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  environmentId: IdSchema,
  range: FrameRangeSchema,
  focusEntityId: IdSchema.optional(),
}).strict();

export const EntityTrackSchema = z.object({
  entityId: IdSchema,
  groundPosition: z.array(GroundPointKeyframeSchema).min(1).optional(),
  worldPosition: z.array(PointKeyframeSchema).min(1).optional(),
  scale: z.array(PositivePointKeyframeSchema).min(1).optional(),
  rotation: z.array(NumberKeyframeSchema).min(1).optional(),
  opacity: z.array(OpacityKeyframeSchema).min(1).optional(),
}).strict().superRefine((track, context) => {
  if (track.groundPosition !== undefined && track.worldPosition !== undefined) {
    context.addIssue({code: 'custom', message: 'Entity track cannot define both groundPosition and worldPosition'});
  }
  addStrictFrameIssue(track.groundPosition, context, ['groundPosition']);
  addStrictFrameIssue(track.worldPosition, context, ['worldPosition']);
  addStrictFrameIssue(track.scale, context, ['scale']);
  addStrictFrameIssue(track.rotation, context, ['rotation']);
  addStrictFrameIssue(track.opacity, context, ['opacity']);
});

export const CameraTrackSchema = z.object({
  shotId: IdSchema,
  position: z.array(PointKeyframeSchema).min(1),
  zoom: z.array(PositiveNumberKeyframeSchema).min(1),
  rotation: z.array(NumberKeyframeSchema).min(1).optional(),
}).strict().superRefine((track, context) => {
  addStrictFrameIssue(track.position, context, ['position']);
  addStrictFrameIssue(track.zoom, context, ['zoom']);
  addStrictFrameIssue(track.rotation, context, ['rotation']);
});

export const PoseEventSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  entityId: IdSchema,
  poseClipId: IdSchema,
  clipStartOffset: z.number().int().nonnegative(),
  playbackRate: FiniteNumberSchema.min(0.5).max(2),
}).strict();

export const PoseTransitionModeSchema = z.enum(['cut', 'crossfade', 'hold-then-cut']);
export const PoseTransitionAnchorPolicySchema = z.enum(['foot', 'center']);

export const PoseTransitionSchema = z.object({
  id: IdSchema,
  entityId: IdSchema,
  fromPoseClipId: IdSchema,
  toPoseClipId: IdSchema,
  startFrame: FrameSchema,
  durationFrames: z.number().int().nonnegative(),
  mode: PoseTransitionModeSchema,
  anchorPolicy: PoseTransitionAnchorPolicySchema,
}).strict().superRefine((transition, context) => {
  if (transition.mode === 'cut' && transition.durationFrames !== 0) {
    context.addIssue({code: 'custom', message: 'cut durationFrames must be 0', path: ['durationFrames']});
  }
  if (transition.mode === 'crossfade' && (transition.durationFrames < 2 || transition.durationFrames > 4)) {
    context.addIssue({code: 'custom', message: 'crossfade durationFrames must be between 2 and 4', path: ['durationFrames']});
  }
  if (transition.mode === 'hold-then-cut' && transition.durationFrames < 1) {
    context.addIssue({code: 'custom', message: 'hold-then-cut durationFrames must be at least 1', path: ['durationFrames']});
  }
});

export function effectivePoseSwitchFrame(transition: z.infer<typeof PoseTransitionSchema>): number {
  return transition.mode === 'hold-then-cut'
    ? transition.startFrame + transition.durationFrames
    : transition.startFrame;
}

export const VisibilityEventSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  entityId: IdSchema,
  visible: z.boolean(),
}).strict();

export const EffectEventSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  effectType: IdSchema,
  assetId: IdSchema.optional(),
  targetEntityId: IdSchema.optional(),
  durationFrames: z.number().int().positive().optional(),
  parameters: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])).optional(),
}).strict();

export const NarrationCueSchema = z.object({
  id: IdSchema,
  range: FrameRangeSchema,
  assetId: IdSchema,
  text: z.string().trim().min(1),
  sampleStart: z.number().int().nonnegative(),
  sampleLength: z.number().int().positive(),
}).strict();

export const SubtitleCueSchema = z.object({
  id: IdSchema,
  range: FrameRangeSchema,
  text: z.string().trim().min(1),
  styleId: IdSchema,
}).strict();

export const SfxCueSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  assetId: IdSchema,
  eventType: IdSchema,
  gainDb: FiniteNumberSchema,
}).strict();

export const CutShotTransitionSchema = z.object({
  id: IdSchema,
  fromShotId: IdSchema,
  toShotId: IdSchema,
  type: z.literal('cut'),
  frame: FrameSchema,
}).strict();

export const TimedShotTransitionSchema = z.object({
  id: IdSchema,
  fromShotId: IdSchema,
  toShotId: IdSchema,
  type: z.enum(['crossfade', 'paper-wipe']),
  range: FrameRangeSchema,
}).strict();

export const ShotTransitionSchema = z.discriminatedUnion('type', [
  CutShotTransitionSchema,
  TimedShotTransitionSchema,
]);

export const TimelineMarkerSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  type: IdSchema,
  entityIds: z.array(IdSchema).optional(),
}).strict();

export const TimelineSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  fps: z.literal(30),
  durationFrames: z.number().int().positive(),
  shots: z.array(ShotSchema).min(1),
  entityTracks: z.array(EntityTrackSchema),
  cameraTracks: z.array(CameraTrackSchema),
  poseEvents: z.array(PoseEventSchema),
  poseTransitions: z.array(PoseTransitionSchema),
  ownershipEvents: z.array(OwnershipEventSchema),
  visibilityEvents: z.array(VisibilityEventSchema),
  effectEvents: z.array(EffectEventSchema),
  narration: z.array(NarrationCueSchema),
  subtitles: z.array(SubtitleCueSchema),
  sfx: z.array(SfxCueSchema),
  transitions: z.array(ShotTransitionSchema),
  markers: z.array(TimelineMarkerSchema),
}).strict().superRefine((timeline, context) => {
  if (timeline.shots[0]?.range.startFrame !== 0) {
    context.addIssue({code: 'custom', message: 'First shot must start at frame 0', path: ['shots', 0, 'range', 'startFrame']});
  }
  for (let index = 1; index < timeline.shots.length; index += 1) {
    const previous = timeline.shots[index - 1];
    const current = timeline.shots[index];
    if (previous !== undefined && current !== undefined && previous.range.endFrame !== current.range.startFrame) {
      context.addIssue({
        code: 'custom',
        message: 'Shots must continuously cover the timeline with no gaps or overlaps',
        path: ['shots', index, 'range', 'startFrame'],
      });
    }
  }
  const lastShot = timeline.shots.at(-1);
  if (lastShot !== undefined && lastShot.range.endFrame !== timeline.durationFrames) {
    context.addIssue({code: 'custom', message: 'Last shot must end at durationFrames', path: ['shots', timeline.shots.length - 1, 'range', 'endFrame']});
  }

  const entityTrackIds = new Set<string>();
  for (const [index, track] of timeline.entityTracks.entries()) {
    if (entityTrackIds.has(track.entityId)) {
      context.addIssue({code: 'custom', message: `Duplicate EntityTrack for ${track.entityId}`, path: ['entityTracks', index, 'entityId']});
    }
    entityTrackIds.add(track.entityId);
  }
  const cameraTrackIds = new Set<string>();
  for (const [index, track] of timeline.cameraTracks.entries()) {
    if (cameraTrackIds.has(track.shotId)) {
      context.addIssue({code: 'custom', message: `Duplicate CameraTrack for ${track.shotId}`, path: ['cameraTracks', index, 'shotId']});
    }
    cameraTrackIds.add(track.shotId);
  }
  const poseEventKeys = new Set<string>();
  for (const [index, event] of timeline.poseEvents.entries()) {
    const key = `${event.entityId}\u0000${event.frame}`;
    if (poseEventKeys.has(key)) {
      context.addIssue({code: 'custom', message: `Duplicate PoseEvent for ${event.entityId} at frame ${event.frame}`, path: ['poseEvents', index]});
    }
    poseEventKeys.add(key);
  }

  const eventCollections: Array<readonly [string, readonly {id: string}[]]> = [
    ['poseEvents', timeline.poseEvents],
    ['poseTransitions', timeline.poseTransitions],
    ['ownershipEvents', timeline.ownershipEvents],
    ['visibilityEvents', timeline.visibilityEvents],
    ['effectEvents', timeline.effectEvents],
    ['narration', timeline.narration],
    ['subtitles', timeline.subtitles],
    ['sfx', timeline.sfx],
    ['transitions', timeline.transitions],
    ['markers', timeline.markers],
  ];
  const eventIds = new Map<string, string>();
  for (const [collectionName, events] of eventCollections) {
    for (const [index, event] of events.entries()) {
      const previousPath = eventIds.get(event.id);
      if (previousPath !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `Timeline event id ${event.id} is already used at ${previousPath}`,
          path: [collectionName, index, 'id'],
        });
      } else {
        eventIds.set(event.id, `${collectionName}.${index}.id`);
      }
    }
  }

  for (const [index, transition] of timeline.poseTransitions.entries()) {
    const switchFrame = effectivePoseSwitchFrame(transition);
    const matchingEvent = timeline.poseEvents.some((event) =>
      event.entityId === transition.entityId
      && event.poseClipId === transition.toPoseClipId
      && event.frame === switchFrame,
    );
    if (!matchingEvent) {
      context.addIssue({
        code: 'custom',
        message: `Pose transition requires matching to-pose event at frame ${switchFrame}`,
        path: ['poseTransitions', index],
      });
    }
    if (transition.mode !== 'crossfade' && transition.anchorPolicy !== 'foot') {
      context.addIssue({
        code: 'custom',
        message: `${transition.mode} transitions only support anchorPolicy=foot in v0.1`,
        path: ['poseTransitions', index, 'anchorPolicy'],
      });
    }
  }
  const transitionsByEntity = new Map<string, Array<{index: number; transition: typeof timeline.poseTransitions[number]}>>();
  for (const [index, transition] of timeline.poseTransitions.entries()) {
    const entries = transitionsByEntity.get(transition.entityId) ?? [];
    entries.push({index, transition});
    transitionsByEntity.set(transition.entityId, entries);
  }
  for (const entries of transitionsByEntity.values()) {
    entries.sort((left, right) => left.transition.startFrame - right.transition.startFrame
      || (left.transition.id < right.transition.id ? -1 : left.transition.id > right.transition.id ? 1 : 0));
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (previous === undefined || current === undefined) continue;
      const previousEnd = previous.transition.startFrame + Math.max(1, previous.transition.durationFrames);
      if (current.transition.startFrame < previousEnd) {
        context.addIssue({
          code: 'custom',
          message: `Pose transitions ${previous.transition.id} and ${current.transition.id} overlap`,
          path: ['poseTransitions', current.index],
        });
      }
    }
  }
  for (const [index, shot] of timeline.shots.entries()) {
    if (shot.range.endFrame > timeline.durationFrames) {
      context.addIssue({code: 'custom', message: 'Shot exceeds timeline duration', path: ['shots', index, 'range']});
    }
  }
});

export type Timeline = z.infer<typeof TimelineSchema>;
export type Easing = z.infer<typeof EasingSchema>;
export type PoseEvent = z.infer<typeof PoseEventSchema>;
export type PoseTransition = z.infer<typeof PoseTransitionSchema>;
