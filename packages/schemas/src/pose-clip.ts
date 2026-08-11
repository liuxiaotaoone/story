import {z} from 'zod';
import {
  FiniteNumberSchema,
  IdSchema,
  NormalizedPointSchema,
} from './common.js';

export const DirectionSchema = z.enum(['left', 'right', 'front']);
export const FootContactSchema = z.enum(['left-foot', 'right-foot', 'both', 'none']);
export const ReferenceFootSchema = z.enum(['left-foot', 'right-foot', 'midpoint', 'auto']);
export const GroundLockModeSchema = z.enum(['always', 'contact-only', 'none']);

export const PoseAnchorsSchema = z.object({
  foot: NormalizedPointSchema,
  leftFoot: NormalizedPointSchema.optional(),
  rightFoot: NormalizedPointSchema.optional(),
  center: NormalizedPointSchema,
  leftHand: NormalizedPointSchema.optional(),
  rightHand: NormalizedPointSchema.optional(),
  head: NormalizedPointSchema.optional(),
  auxiliary: z.record(IdSchema, NormalizedPointSchema).optional(),
}).strict();

export const PoseClipFrameSchema = z.object({
  assetId: IdSchema,
  durationFrames: z.number().int().positive(),
  anchors: PoseAnchorsSchema,
  contact: z.object({type: FootContactSchema}).strict().optional(),
  referenceFoot: ReferenceFootSchema.optional(),
}).strict();

export const GroundLockSchema = z.object({
  mode: GroundLockModeSchema,
  maxCorrectionPx: FiniteNumberSchema.nonnegative(),
}).strict();

export const PoseClipSchema = z.object({
  id: IdSchema,
  entityType: IdSchema,
  action: IdSchema,
  loop: z.boolean(),
  direction: DirectionSchema,
  frames: z.array(PoseClipFrameSchema).min(1),
  rootMotion: z.object({mode: z.literal('timeline')}).strict(),
  groundLock: GroundLockSchema,
  tags: z.array(IdSchema).optional(),
  compositeMembers: z.array(IdSchema).optional(),
}).strict().superRefine((clip, context) => {
  for (const [index, frame] of clip.frames.entries()) {
    const contact = frame.contact?.type ?? 'none';
    if (clip.groundLock.mode === 'contact-only') {
      if (contact === 'left-foot' && frame.anchors.leftFoot === undefined) {
        context.addIssue({code: 'custom', message: 'left-foot contact requires leftFoot anchor', path: ['frames', index, 'anchors', 'leftFoot']});
      }
      if (contact === 'right-foot' && frame.anchors.rightFoot === undefined) {
        context.addIssue({code: 'custom', message: 'right-foot contact requires rightFoot anchor', path: ['frames', index, 'anchors', 'rightFoot']});
      }
      if (contact === 'both' && (frame.anchors.leftFoot === undefined || frame.anchors.rightFoot === undefined)) {
        context.addIssue({code: 'custom', message: 'both-foot contact requires leftFoot and rightFoot anchors', path: ['frames', index, 'anchors']});
      }
    }
    if (frame.referenceFoot === 'left-foot' && frame.anchors.leftFoot === undefined) {
      context.addIssue({code: 'custom', message: 'left-foot reference requires leftFoot anchor', path: ['frames', index, 'referenceFoot']});
    }
    if (frame.referenceFoot === 'right-foot' && frame.anchors.rightFoot === undefined) {
      context.addIssue({code: 'custom', message: 'right-foot reference requires rightFoot anchor', path: ['frames', index, 'referenceFoot']});
    }
    if (frame.referenceFoot === 'midpoint' && (frame.anchors.leftFoot === undefined || frame.anchors.rightFoot === undefined)) {
      context.addIssue({code: 'custom', message: 'midpoint reference requires both foot anchors', path: ['frames', index, 'referenceFoot']});
    }
  }
});

export type Direction = z.infer<typeof DirectionSchema>;
export type FootContact = z.infer<typeof FootContactSchema>;
export type PoseAnchors = z.infer<typeof PoseAnchorsSchema>;
export type PoseClipFrame = z.infer<typeof PoseClipFrameSchema>;
export type PoseClip = z.infer<typeof PoseClipSchema>;
