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
  scale: z.array(PointKeyframeSchema).min(1).optional(),
  rotation: z.array(NumberKeyframeSchema).min(1).optional(),
  opacity: z.array(NumberKeyframeSchema).min(1).optional(),
}).strict().refine(
  ({groundPosition, worldPosition}) => !(groundPosition !== undefined && worldPosition !== undefined),
  {message: 'Entity track cannot define both groundPosition and worldPosition'},
);

export const CameraTrackSchema = z.object({
  shotId: IdSchema,
  position: z.array(PointKeyframeSchema).min(1),
  zoom: z.array(NumberKeyframeSchema).min(1),
  rotation: z.array(NumberKeyframeSchema).min(1).optional(),
}).strict();

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

export const ShotTransitionSchema = z.object({
  id: IdSchema,
  fromShotId: IdSchema,
  toShotId: IdSchema,
  range: FrameRangeSchema,
  type: z.enum(['cut', 'crossfade', 'paper-wipe']),
}).strict();

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
  }
  for (const [index, shot] of timeline.shots.entries()) {
    if (shot.range.endFrame > timeline.durationFrames) {
      context.addIssue({code: 'custom', message: 'Shot exceeds timeline duration', path: ['shots', index, 'range']});
    }
  }
});

export type Timeline = z.infer<typeof TimelineSchema>;
export type PoseEvent = z.infer<typeof PoseEventSchema>;
export type PoseTransition = z.infer<typeof PoseTransitionSchema>;
