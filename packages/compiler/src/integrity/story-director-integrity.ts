import {
  type DirectorOverride,
  DirectorPlanSchema,
  StorySchema,
  canonicalHash,
  type DirectorPlan,
  type Story,
} from '@pose-clip/schemas';
import {applyDirectorOverrides} from '../override/apply-director-overrides.js';

export class StoryDirectorIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryDirectorIntegrityError';
  }
}

export async function hashStory(story: Story): Promise<string> {
  return canonicalHash('story-v1', StorySchema.parse(story));
}

export async function validateDirectorPlanAgainstStory(storyInput: Story, planInput: DirectorPlan): Promise<void> {
  const story = StorySchema.parse(storyInput);
  const plan = DirectorPlanSchema.parse(planInput);
  if (plan.storyId !== story.id) {
    throw new StoryDirectorIntegrityError(`DirectorPlan storyId ${plan.storyId} does not match Story ${story.id}`);
  }
  const storyHash = await hashStory(story);
  if (plan.sourceStoryHash !== storyHash) {
    throw new StoryDirectorIntegrityError('DirectorPlan sourceStoryHash does not match Story content');
  }
  const storyCharacters = new Map(story.characters.map(character => [character.id, character.entityType]));
  for (const character of plan.characters) {
    const entityType = storyCharacters.get(character.characterId);
    if (entityType === undefined) {
      throw new StoryDirectorIntegrityError(`DirectorPlan introduces unknown Story character ${character.characterId}`);
    }
    if (entityType !== character.entityType) {
      throw new StoryDirectorIntegrityError(`Character ${character.characterId} entityType does not match Story`);
    }
  }
  const beatIds = new Set(story.beats.map(beat => beat.id));
  for (const scene of plan.scenes) {
    for (const beatId of scene.sourceBeatIds) {
      if (!beatIds.has(beatId)) {
        throw new StoryDirectorIntegrityError(`DirectorScene ${scene.id} references unknown Story beat ${beatId}`);
      }
    }
  }
}

export async function createEffectiveDirectorPlan(input: {
  story: Story;
  directorPlan: DirectorPlan;
  overrides: readonly DirectorOverride[];
}) {
  const story = StorySchema.parse(input.story);
  const directorPlan = DirectorPlanSchema.parse(input.directorPlan);
  await validateDirectorPlanAgainstStory(story, directorPlan);
  return applyDirectorOverrides(directorPlan, input.overrides);
}
