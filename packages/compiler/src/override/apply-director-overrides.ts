import {
  DirectorOverrideSchema,
  DirectorPlanSchema,
  EffectiveDirectorPlanSchema,
  canonicalHash,
  type DirectorOverride,
  type DirectorPlan,
  type EffectiveDirectorPlan,
  type JsonValue,
} from '@pose-clip/schemas';
import {applyJsonPointerOperation} from './json-pointer.js';

export class DirectorOverrideError extends Error {
  overrideId: string | undefined;

  constructor(message: string, overrideId?: string) {
    super(message);
    this.name = 'DirectorOverrideError';
    this.overrideId = overrideId;
  }
}

export async function hashDirectorPlan(plan: DirectorPlan): Promise<string> {
  return canonicalHash('director-plan-v1', plan);
}

export async function applyDirectorOverrides(
  source: DirectorPlan,
  overrides: readonly DirectorOverride[],
): Promise<EffectiveDirectorPlan> {
  const sourcePlan = DirectorPlanSchema.parse(source);
  const sourceDirectorPlanHash = await hashDirectorPlan(sourcePlan);
  const document = structuredClone(sourcePlan) as unknown as JsonValue;
  const ids = new Set<string>();

  for (const rawOverride of overrides) {
    const override = DirectorOverrideSchema.parse(rawOverride);
    if (ids.has(override.id)) throw new DirectorOverrideError(`Duplicate DirectorOverride id: ${override.id}`, override.id);
    ids.add(override.id);
    if (override.sourceDirectorPlanHash !== sourceDirectorPlanHash) {
      throw new DirectorOverrideError(`DirectorOverride ${override.id} targets a different source DirectorPlan`, override.id);
    }
    try {
      applyJsonPointerOperation(document, override.operation, override.targetPath, override.value);
    } catch (error) {
      throw new DirectorOverrideError(error instanceof Error ? error.message : String(error), override.id);
    }
  }

  const planResult = DirectorPlanSchema.safeParse(document);
  if (!planResult.success) {
    throw new DirectorOverrideError(`Effective DirectorPlan validation failed: ${planResult.error.issues[0]?.message ?? 'unknown error'}`);
  }
  const effectivePlanHash = await canonicalHash('effective-director-plan-v1', {
    sourceDirectorPlanHash,
    overrideIds: [...ids],
    plan: planResult.data,
  });
  return EffectiveDirectorPlanSchema.parse({
    sourceDirectorPlanHash,
    overrideIds: [...ids],
    effectivePlanHash,
    plan: planResult.data,
  });
}
