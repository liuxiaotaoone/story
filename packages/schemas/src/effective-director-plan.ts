import {z} from 'zod';
import {ContentHashSchema, IdSchema} from './common.js';
import {DirectorPlanSchema} from './director-plan.js';

export const EffectiveDirectorPlanSchema = z.object({
  sourceDirectorPlanHash: ContentHashSchema,
  overrideIds: z.array(IdSchema),
  effectivePlanHash: ContentHashSchema,
  plan: DirectorPlanSchema,
}).strict();

export type EffectiveDirectorPlan = z.infer<typeof EffectiveDirectorPlanSchema>;
