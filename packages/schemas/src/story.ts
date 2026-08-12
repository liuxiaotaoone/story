import {z} from 'zod';
import {IdSchema} from './common.js';

export const StoryCharacterSchema = z.object({
  id: IdSchema,
  entityType: IdSchema,
  description: z.string().trim().min(1),
  traits: z.array(z.string().trim().min(1)),
  preferredVoiceId: IdSchema.optional(),
}).strict();

export const StoryBeatSchema = z.object({
  id: IdSchema,
  summary: z.string().trim().min(1),
  participantIds: z.array(IdSchema),
  narration: z.string().trim().min(1).optional(),
}).strict();

export const StorySchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  id: IdSchema,
  title: z.string().trim().min(1),
  language: z.string().trim().min(1),
  domain: IdSchema,
  synopsis: z.string().trim().min(1),
  characters: z.array(StoryCharacterSchema).min(1),
  beats: z.array(StoryBeatSchema).min(1),
}).strict().superRefine((story, context) => {
  const characterIds = new Set<string>();
  for (const [index, character] of story.characters.entries()) {
    if (characterIds.has(character.id)) {
      context.addIssue({code: 'custom', message: `Duplicate story character id: ${character.id}`, path: ['characters', index, 'id']});
    }
    characterIds.add(character.id);
  }
  const beatIds = new Set<string>();
  for (const [index, beat] of story.beats.entries()) {
    if (beatIds.has(beat.id)) {
      context.addIssue({code: 'custom', message: `Duplicate story beat id: ${beat.id}`, path: ['beats', index, 'id']});
    }
    beatIds.add(beat.id);
    for (const participantId of beat.participantIds) {
      if (!characterIds.has(participantId)) {
        context.addIssue({code: 'custom', message: `Unknown story participant: ${participantId}`, path: ['beats', index, 'participantIds']});
      }
    }
  }
});

export type StoryCharacter = z.infer<typeof StoryCharacterSchema>;
export type StoryBeat = z.infer<typeof StoryBeatSchema>;
export type Story = z.infer<typeof StorySchema>;
