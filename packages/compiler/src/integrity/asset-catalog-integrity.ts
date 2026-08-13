import {
  ResolvedAssetCatalogSchema,
  canonicalHash,
  type PreflightCompileResult,
  type ResolvedAssetCatalog,
} from '@pose-clip/schemas';
import {CompileIntegrityError} from './hash-integrity.js';

export type ResolvedAssetCatalogPayload = Omit<ResolvedAssetCatalog, 'catalogHash'>;

export async function hashResolvedAssetCatalogPayload(payload: ResolvedAssetCatalogPayload): Promise<string> {
  return canonicalHash('resolved-asset-catalog-v1', payload);
}

export async function assertResolvedAssetCatalogIntegrity(input: ResolvedAssetCatalog): Promise<ResolvedAssetCatalog> {
  const catalog = ResolvedAssetCatalogSchema.parse(input);
  const {catalogHash, ...payload} = catalog;
  if (await hashResolvedAssetCatalogPayload(payload) !== catalogHash) {
    throw new CompileIntegrityError('ResolvedAssetCatalog content does not match catalogHash');
  }
  return catalog;
}

export function assertAssetRequirementsResolved(
  preflight: PreflightCompileResult,
  catalog: ResolvedAssetCatalog,
): void {
  for (const requirement of preflight.assetRequirements.filter(candidate => candidate.required)) {
    if (requirement.kind === 'environment-layer') {
      if (!catalog.environments.some(environment => environment.id === requirement.environmentIntent)) {
        throw new CompileIntegrityError(`Required environment ${requirement.environmentIntent} was not resolved`);
      }
      continue;
    }
    if (requirement.kind === 'character-frame' || requirement.kind === 'animal-frame') {
      const poseClip = catalog.poseClips.find(clip =>
        clip.entityType === requirement.entityType
        && clip.action === requirement.action
        && clip.direction === requirement.direction,
      );
      if (poseClip === undefined) {
        throw new CompileIntegrityError(`Required PoseClip ${requirement.entityType}/${requirement.action}/${requirement.direction} was not resolved`);
      }
      continue;
    }
    if (requirement.kind === 'prop') {
      if (!catalog.landmarkBindings?.some(binding => binding.landmarkType === requirement.entityType)) {
        throw new CompileIntegrityError(`Required landmark ${requirement.entityType} was not resolved`);
      }
      continue;
    }
    if (requirement.kind === 'effect' && !catalog.effectBindings?.some(binding => binding.effectType === requirement.entityType)) {
      throw new CompileIntegrityError(`Required effect ${requirement.entityType} was not resolved`);
    }
  }
}
