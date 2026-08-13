import {z} from 'zod';
import {AttachmentSlotDefinitionSchema, OwnerRefSchema} from './attachment.js';
import {FrameRangeSchema, IdSchema} from './common.js';
import {InteractionAnchorSchema} from './interaction.js';

export const EntityDefinitionSchema = z.object({
  id: IdSchema,
  entityType: IdSchema,
  displayName: z.string().trim().min(1),
  poseClipIds: z.array(IdSchema).min(1),
  defaultPoseClipId: IdSchema,
  attachmentSlots: z.array(AttachmentSlotDefinitionSchema),
  interactionAnchors: z.array(InteractionAnchorSchema).optional(),
  tags: z.array(IdSchema).optional(),
}).strict().superRefine((entity, context) => {
  if (!entity.poseClipIds.includes(entity.defaultPoseClipId)) {
    context.addIssue({
      code: 'custom',
      message: 'defaultPoseClipId must appear in poseClipIds',
      path: ['defaultPoseClipId'],
    });
  }
  const slotIds = new Set<string>();
  for (const [index, slot] of entity.attachmentSlots.entries()) {
    if (slotIds.has(slot.id)) {
      context.addIssue({code: 'custom', message: `Duplicate attachment slot: ${slot.id}`, path: ['attachmentSlots', index, 'id']});
    }
    slotIds.add(slot.id);
  }
  const interactionAnchorIds = new Set<string>();
  for (const [index, anchor] of (entity.interactionAnchors ?? []).entries()) {
    if (interactionAnchorIds.has(anchor.id)) context.addIssue({code: 'custom', message: `Duplicate interaction anchor: ${anchor.id}`, path: ['interactionAnchors', index, 'id']});
    interactionAnchorIds.add(anchor.id);
  }
});

export const EntityInstanceSchema = z.object({
  id: IdSchema,
  definitionId: IdSchema,
  sceneId: IdSchema,
  activeRange: FrameRangeSchema,
  initialOwner: OwnerRefSchema,
}).strict();

export type EntityDefinition = z.infer<typeof EntityDefinitionSchema>;
export type EntityInstance = z.infer<typeof EntityInstanceSchema>;
