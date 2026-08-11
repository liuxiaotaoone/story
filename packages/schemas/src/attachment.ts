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

export const BakedBindingSchema = z.object({
  ownerEntityId: IdSchema,
  childEntityId: IdSchema,
  compositeSlotId: IdSchema,
}).strict();

export const OwnershipEventSchema = z.object({
  id: IdSchema,
  frame: FrameSchema,
  type: z.enum(['attach', 'detach']),
  entityId: IdSchema,
  from: OwnerRefSchema,
  to: OwnerRefSchema,
  mode: AttachmentModeSchema,
  preserveWorldTransform: z.literal(false),
  socketBinding: SocketBindingSchema.optional(),
  bakedBinding: BakedBindingSchema.optional(),
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
  if (event.type === 'attach' && event.mode === 'socket' && event.socketBinding === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'socket attachment requires socketBinding',
      path: ['socketBinding'],
    });
  }
  if ((event.type === 'detach' || event.mode === 'baked') && event.socketBinding !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'detach and baked events must not define socketBinding',
      path: ['socketBinding'],
    });
  }
  if (event.type === 'attach' && event.mode === 'baked' && event.bakedBinding === undefined) {
    context.addIssue({code: 'custom', message: 'baked attachment requires bakedBinding', path: ['bakedBinding']});
  }
  if ((event.type === 'detach' || event.mode === 'socket') && event.bakedBinding !== undefined) {
    context.addIssue({code: 'custom', message: 'detach and socket events must not define bakedBinding', path: ['bakedBinding']});
  }
  if (event.bakedBinding !== undefined) {
    if (event.bakedBinding.childEntityId !== event.entityId) {
      context.addIssue({code: 'custom', message: 'bakedBinding.childEntityId must equal entityId', path: ['bakedBinding', 'childEntityId']});
    }
    if (event.to.kind === 'entity' && event.bakedBinding.ownerEntityId !== event.to.entityId) {
      context.addIssue({code: 'custom', message: 'bakedBinding.ownerEntityId must equal to.entityId', path: ['bakedBinding', 'ownerEntityId']});
    }
  }
});

export type AttachmentMode = z.infer<typeof AttachmentModeSchema>;
export type AttachmentAnchor = z.infer<typeof AttachmentAnchorSchema>;
export type AttachmentSlotDefinition = z.infer<typeof AttachmentSlotDefinitionSchema>;
export type OwnerRef = z.infer<typeof OwnerRefSchema>;
export type SocketBinding = z.infer<typeof SocketBindingSchema>;
export type BakedBinding = z.infer<typeof BakedBindingSchema>;
export type OwnershipEvent = z.infer<typeof OwnershipEventSchema>;
