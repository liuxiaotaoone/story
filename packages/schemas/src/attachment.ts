import {z} from 'zod';
import {
  FiniteNumberSchema,
  FrameSchema,
  IdSchema,
  NormalizedPointSchema,
} from './common.js';

export const AttachmentModeSchema = z.enum(['socket', 'baked']);

export const AttachmentAnchorSchema = z.object({
  id: IdSchema,
  point: NormalizedPointSchema,
}).strict();

export const AttachmentSlotDefinitionSchema = z.object({
  id: IdSchema,
  ownerAnchor: IdSchema,
}).strict();

export const WorldOwnerRefSchema = z.object({
  kind: z.literal('world'),
  environmentId: IdSchema,
}).strict();

export const EntityOwnerRefSchema = z.object({
  kind: z.literal('entity'),
  entityId: IdSchema,
  slot: IdSchema,
}).strict();

export const OwnerRefSchema = z.discriminatedUnion('kind', [
  WorldOwnerRefSchema,
  EntityOwnerRefSchema,
]);

export const SocketBindingSchema = z.object({
  attachmentAnchorId: IdSchema,
  inheritRotation: z.boolean(),
  inheritScale: z.boolean(),
  rotationOffset: FiniteNumberSchema.optional(),
  scaleMultiplier: FiniteNumberSchema.positive().optional(),
}).strict();

export const OwnershipEventSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  type: z.enum(['attach', 'detach']),
  entityId: IdSchema,
  from: OwnerRefSchema,
  to: OwnerRefSchema,
  mode: AttachmentModeSchema,
  preserveWorldTransform: z.boolean(),
  socketBinding: SocketBindingSchema.optional(),
}).strict().superRefine((event, context) => {
  if (event.type === 'attach' && event.to.kind !== 'entity') {
    context.addIssue({
      code: 'custom',
      message: 'attach must transfer ownership to an entity slot',
      path: ['to'],
    });
  }
  if (event.type === 'detach' && event.to.kind !== 'world') {
    context.addIssue({
      code: 'custom',
      message: 'detach must transfer ownership to the world',
      path: ['to'],
    });
  }
  if (event.mode === 'socket' && event.socketBinding === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'socket attachment requires socketBinding',
      path: ['socketBinding'],
    });
  }
  if (event.mode === 'baked' && event.socketBinding !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'baked attachment must not define socketBinding',
      path: ['socketBinding'],
    });
  }
});

export type AttachmentMode = z.infer<typeof AttachmentModeSchema>;
export type AttachmentAnchor = z.infer<typeof AttachmentAnchorSchema>;
export type AttachmentSlotDefinition = z.infer<typeof AttachmentSlotDefinitionSchema>;
export type OwnerRef = z.infer<typeof OwnerRefSchema>;
export type SocketBinding = z.infer<typeof SocketBindingSchema>;
export type OwnershipEvent = z.infer<typeof OwnershipEventSchema>;
