import {z} from 'zod';
import {ContentHashSchema, IdSchema, IsoDateTimeSchema, JsonValueSchema} from './common.js';

const forbiddenPathSegment = /(?:^|\/)(?:assets?|renderPlan|renderState|timeline|poseClips?|frames?|pixels?|groundLock|pixi)(?:\/|$)/iu;

export const DirectorOverrideSchema = z.object({
  id: IdSchema,
  sourceDirectorPlanHash: ContentHashSchema,
  targetPath: z.string().startsWith('/').refine(path => !forbiddenPathSegment.test(path), 'Override path crosses the DirectorPlan boundary'),
  operation: z.enum(['replace', 'remove', 'insert']),
  value: JsonValueSchema.optional(),
  reason: z.string().trim().min(1),
  createdBy: IdSchema,
  createdAt: IsoDateTimeSchema,
}).strict().superRefine((override, context) => {
  if (override.operation === 'remove' && override.value !== undefined) {
    context.addIssue({code: 'custom', message: 'remove must not define value', path: ['value']});
  }
  if (override.operation !== 'remove' && override.value === undefined) {
    context.addIssue({code: 'custom', message: `${override.operation} requires value`, path: ['value']});
  }
});

export type DirectorOverride = z.infer<typeof DirectorOverrideSchema>;
