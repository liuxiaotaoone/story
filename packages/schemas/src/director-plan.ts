import {z} from 'zod';
import {IdSchema} from './common.js';
import {DirectionSchema} from './pose-clip.js';

export const CameraIntentSchema = z.enum([
  'static',
  'slow-push-in',
  'slow-pull-out',
  'pan-left',
  'pan-right',
  'follow',
]);
export const ShotTypeSchema = z.enum(['wide', 'medium', 'close-up']);
export const HorizontalIntentSchema = z.enum(['far-left', 'left', 'center', 'right', 'far-right']);
export const DepthIntentSchema = z.enum(['background', 'midground', 'ground', 'foreground']);

export const BlockingIntentSchema = z.object({
  horizontal: HorizontalIntentSchema,
  depth: DepthIntentSchema,
  facing: DirectionSchema.optional(),
}).strict();

export const DurationPreferenceSchema = z.object({
  minSeconds: z.number().finite().nonnegative().optional(),
  preferredSeconds: z.number().finite().positive().optional(),
  maxSeconds: z.number().finite().positive().optional(),
}).strict().superRefine((preference, context) => {
  if (preference.minSeconds !== undefined && preference.maxSeconds !== undefined && preference.minSeconds > preference.maxSeconds) {
    context.addIssue({code: 'custom', message: 'minSeconds must not exceed maxSeconds', path: ['minSeconds']});
  }
  if (preference.preferredSeconds !== undefined) {
    if (preference.minSeconds !== undefined && preference.preferredSeconds < preference.minSeconds) {
      context.addIssue({code: 'custom', message: 'preferredSeconds must be at least minSeconds', path: ['preferredSeconds']});
    }
    if (preference.maxSeconds !== undefined && preference.preferredSeconds > preference.maxSeconds) {
      context.addIssue({code: 'custom', message: 'preferredSeconds must not exceed maxSeconds', path: ['preferredSeconds']});
    }
  }
});

export const DirectorCharacterIntentSchema = z.object({
  characterId: IdSchema,
  entityType: IdSchema,
  role: z.string().trim().min(1),
  initialBlocking: BlockingIntentSchema,
}).strict();

export const DirectorSceneSchema = z.object({
  id: IdSchema,
  sourceBeatIds: z.array(IdSchema).min(1),
  environmentIntent: IdSchema,
  summary: z.string().trim().min(1),
}).strict();

export const DirectorShotSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  shotType: ShotTypeSchema,
  focusEntityId: IdSchema.optional(),
  durationPreference: DurationPreferenceSchema.optional(),
}).strict();

export const ActionIntentSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  shotId: IdSchema,
  actorId: IdSchema,
  action: IdSchema,
  targetId: IdSchema.optional(),
  direction: DirectionSchema.optional(),
  priority: z.enum(['required', 'optional']),
  enabled: z.boolean().default(true),
  durationPreference: DurationPreferenceSchema.optional(),
}).strict();

export const NarrationIntentSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  shotId: IdSchema,
  text: z.string().trim().min(1),
  voiceId: IdSchema,
  language: z.string().trim().min(1),
  speed: z.number().finite().min(0.8).max(1.2).default(1),
}).strict();

export const CameraIntentDefinitionSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  shotId: IdSchema,
  type: CameraIntentSchema,
  focusEntityId: IdSchema.optional(),
}).strict();

export const CharacterBlockingIntentSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  shotId: IdSchema,
  characterId: IdSchema,
  blocking: BlockingIntentSchema,
}).strict();

export const StoryBibleSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  styleGuideId: IdSchema,
}).strict();

export const DirectorPlanSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  projectId: IdSchema,
  storyId: IdSchema,
  storyBible: StoryBibleSchema,
  characters: z.array(DirectorCharacterIntentSchema).min(1),
  scenes: z.array(DirectorSceneSchema).min(1),
  shots: z.array(DirectorShotSchema).min(1),
  narration: z.array(NarrationIntentSchema),
  actions: z.array(ActionIntentSchema),
  cameraIntents: z.array(CameraIntentDefinitionSchema),
  blockingIntents: z.array(CharacterBlockingIntentSchema),
}).strict().superRefine((plan, context) => {
  const uniqueIds = (values: Array<{id: string}>, path: string): Set<string> => {
    const ids = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (ids.has(value.id)) context.addIssue({code: 'custom', message: `Duplicate ${path} id: ${value.id}`, path: [path, index, 'id']});
      ids.add(value.id);
    }
    return ids;
  };
  const characterIds = new Set(plan.characters.map(character => character.characterId));
  if (characterIds.size !== plan.characters.length) context.addIssue({code: 'custom', message: 'Director character ids must be unique', path: ['characters']});
  const sceneIds = uniqueIds(plan.scenes, 'scenes');
  const shotIds = uniqueIds(plan.shots, 'shots');
  uniqueIds(plan.narration, 'narration');
  uniqueIds(plan.actions, 'actions');
  uniqueIds(plan.cameraIntents, 'cameraIntents');
  uniqueIds(plan.blockingIntents, 'blockingIntents');
  const checkShot = (value: {sceneId: string; shotId: string}, path: string, index: number): void => {
    if (!sceneIds.has(value.sceneId)) context.addIssue({code: 'custom', message: `Unknown scene: ${value.sceneId}`, path: [path, index, 'sceneId']});
    const shot = plan.shots.find(candidate => candidate.id === value.shotId);
    if (shot === undefined) context.addIssue({code: 'custom', message: `Unknown shot: ${value.shotId}`, path: [path, index, 'shotId']});
    else if (shot.sceneId !== value.sceneId) context.addIssue({code: 'custom', message: `Shot ${value.shotId} does not belong to scene ${value.sceneId}`, path: [path, index, 'shotId']});
  };
  for (const [index, shot] of plan.shots.entries()) {
    if (!sceneIds.has(shot.sceneId)) context.addIssue({code: 'custom', message: `Unknown scene: ${shot.sceneId}`, path: ['shots', index, 'sceneId']});
    if (shot.focusEntityId !== undefined && !characterIds.has(shot.focusEntityId)) context.addIssue({code: 'custom', message: `Unknown focus character: ${shot.focusEntityId}`, path: ['shots', index, 'focusEntityId']});
  }
  for (const [index, narration] of plan.narration.entries()) checkShot(narration, 'narration', index);
  for (const [index, action] of plan.actions.entries()) {
    checkShot(action, 'actions', index);
    if (!characterIds.has(action.actorId)) context.addIssue({code: 'custom', message: `Unknown action actor: ${action.actorId}`, path: ['actions', index, 'actorId']});
    if (action.targetId !== undefined && !characterIds.has(action.targetId)) context.addIssue({code: 'custom', message: `Unknown action target: ${action.targetId}`, path: ['actions', index, 'targetId']});
  }
  for (const [index, camera] of plan.cameraIntents.entries()) checkShot(camera, 'cameraIntents', index);
  for (const [index, blocking] of plan.blockingIntents.entries()) {
    checkShot(blocking, 'blockingIntents', index);
    if (!characterIds.has(blocking.characterId)) context.addIssue({code: 'custom', message: `Unknown blocking character: ${blocking.characterId}`, path: ['blockingIntents', index, 'characterId']});
  }
  for (const shotId of shotIds) {
    if (plan.cameraIntents.filter(intent => intent.shotId === shotId).length !== 1) {
      context.addIssue({code: 'custom', message: `Shot ${shotId} must have exactly one CameraIntent`, path: ['cameraIntents']});
    }
  }
});

export type CameraIntent = z.infer<typeof CameraIntentSchema>;
export type BlockingIntent = z.infer<typeof BlockingIntentSchema>;
export type DurationPreference = z.infer<typeof DurationPreferenceSchema>;
export type DirectorCharacterIntent = z.infer<typeof DirectorCharacterIntentSchema>;
export type DirectorScene = z.infer<typeof DirectorSceneSchema>;
export type DirectorShot = z.infer<typeof DirectorShotSchema>;
export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type NarrationIntent = z.infer<typeof NarrationIntentSchema>;
export type CameraIntentDefinition = z.infer<typeof CameraIntentDefinitionSchema>;
export type CharacterBlockingIntent = z.infer<typeof CharacterBlockingIntentSchema>;
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;
