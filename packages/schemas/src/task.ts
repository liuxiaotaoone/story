import {z} from 'zod';
import {
  ContentHashSchema,
  IdSchema,
  IsoDateTimeSchema,
  ProducerRefSchema,
  SemverSchema,
} from './common.js';

export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'invalidated',
  'cancelled',
]);

export const TaskNodeSchema = z.object({
  nodeId: IdSchema,
  type: IdSchema,
  inputHash: ContentHashSchema,
  promptHash: ContentHashSchema.optional(),
  modelId: IdSchema.optional(),
  modelVersion: z.string().trim().min(1).optional(),
  workflowVersion: SemverSchema,
  producer: ProducerRefSchema,
  seed: z.number().int().optional(),
  outputHash: ContentHashSchema.optional(),
  dependencies: z.array(IdSchema),
  status: TaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

export function taskCacheKeyMaterial(task: z.infer<typeof TaskNodeSchema>, dependencyOutputHashes: readonly string[]): string {
  return JSON.stringify({
    inputHash: task.inputHash,
    dependencyOutputHashes: [...dependencyOutputHashes].sort(),
    producer: task.producer,
    modelId: task.modelId ?? null,
    modelVersion: task.modelVersion ?? null,
    workflowVersion: task.workflowVersion,
    seed: task.seed ?? null,
  });
}

export type TaskNode = z.infer<typeof TaskNodeSchema>;
