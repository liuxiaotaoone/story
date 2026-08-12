import {
  CapabilityCatalogSchema,
  EffectiveDirectorPlanSchema,
  canonicalHash,
  type CapabilityCatalog,
  type EffectiveDirectorPlan,
} from '@pose-clip/schemas';

export class CompileIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileIntegrityError';
  }
}

export async function hashCapabilityCatalog(catalog: CapabilityCatalog): Promise<string> {
  return canonicalHash('capability-catalog-v1', CapabilityCatalogSchema.parse(catalog));
}

export async function assertEffectiveDirectorPlanIntegrity(input: EffectiveDirectorPlan): Promise<EffectiveDirectorPlan> {
  const effective = EffectiveDirectorPlanSchema.parse(input);
  const computedHash = await canonicalHash('effective-director-plan-v1', {
    sourceDirectorPlanHash: effective.sourceDirectorPlanHash,
    overrideIds: effective.overrideIds,
    plan: effective.plan,
  });
  if (computedHash !== effective.effectivePlanHash) {
    throw new CompileIntegrityError('EffectiveDirectorPlan content does not match effectivePlanHash');
  }
  return effective;
}
