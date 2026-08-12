import {z} from 'zod';
import {ContentHashSchema, IdSchema, IsoDateTimeSchema, JsonValueSchema} from './common.js';

export const DIRECTOR_OVERRIDE_TARGET_ROOTS = [
  'actions',
  'cameraIntents',
  'narration',
  'blockingIntents',
  'shots',
] as const;

const targetRootPattern = new RegExp(`^/(?:${DIRECTOR_OVERRIDE_TARGET_ROOTS.join('|')})/[^/]+(?:/[^/]+)*$`, 'u');
export const DirectorOverrideTargetPathSchema = z.string().refine(
  path => targetRootPattern.test(path),
  'Override path must target an allowed DirectorPlan semantic collection',
);

export const DirectorOverrideSchema = z.object({
  id: IdSchema,
  sourceDirectorPlanHash: ContentHashSchema,
  targetPath: DirectorOverrideTargetPathSchema,
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
