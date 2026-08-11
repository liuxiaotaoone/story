import {z} from 'zod';
import {
  ContentHashSchema,
  IdSchema,
  IsoDateTimeSchema,
  ProducerRefSchema,
  SemverSchema,
} from './common.js';
import {canonicalizeJson} from './hash.js';

export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'invalidated',
  'cancelled',
]);

export const TaskDependencySchema = z.object({
  role: IdSchema,
  nodeId: IdSchema,
  outputHash: ContentHashSchema,
}).strict();

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
  dependencies: z.array(TaskDependencySchema),
  status: TaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

export function taskCacheKeyMaterial(task: z.infer<typeof TaskNodeSchema>): string {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const dependencies = [...task.dependencies].sort((left, right) =>
    compare(left.role, right.role)
      || compare(left.nodeId, right.nodeId)
      || compare(left.outputHash, right.outputHash));
  return canonicalizeJson({
    inputHash: task.inputHash,
    promptHash: task.promptHash ?? null,
    dependencies,
    producer: task.producer,
    modelId: task.modelId ?? null,
    modelVersion: task.modelVersion ?? null,
    workflowVersion: task.workflowVersion,
    seed: task.seed ?? null,
  });
}

export type TaskNode = z.infer<typeof TaskNodeSchema>;
export type TaskDependency = z.infer<typeof TaskDependencySchema>;
