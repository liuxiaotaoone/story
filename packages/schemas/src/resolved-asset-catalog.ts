import {z} from 'zod';
import {AssetManifestSchema} from './asset.js';
import {ContentHashSchema} from './common.js';
import {EntityDefinitionSchema} from './entity.js';
import {EnvironmentDefinitionSchema} from './environment.js';
import {PoseClipSchema} from './pose-clip.js';

export const ResolvedAssetCatalogSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  mode: z.enum(['experiment', 'production']),
  productionReady: z.boolean(),
  catalogHash: ContentHashSchema,
  assets: AssetManifestSchema,
  poseClips: z.array(PoseClipSchema),
  environments: z.array(EnvironmentDefinitionSchema),
  entityDefinitions: z.array(EntityDefinitionSchema),
}).strict().superRefine((catalog, context) => {
  if (catalog.mode === 'production' && !catalog.productionReady) {
    context.addIssue({code: 'custom', message: 'Production asset catalogs must be productionReady', path: ['productionReady']});
  }
  const uniqueIds = (values: readonly {id: string}[], path: string): void => {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seen.has(value.id)) context.addIssue({code: 'custom', message: `Duplicate ${path} id: ${value.id}`, path: [path, index, 'id']});
      seen.add(value.id);
    }
  };
  uniqueIds(catalog.poseClips, 'poseClips');
  uniqueIds(catalog.environments, 'environments');
  uniqueIds(catalog.entityDefinitions, 'entityDefinitions');
  const assetIds = new Set(catalog.assets.assets.map(asset => asset.id));
  for (const [clipIndex, clip] of catalog.poseClips.entries()) {
    for (const [frameIndex, frame] of clip.frames.entries()) {
      if (!assetIds.has(frame.assetId)) context.addIssue({
        code: 'custom', message: `PoseClip references unknown asset ${frame.assetId}`,
        path: ['poseClips', clipIndex, 'frames', frameIndex, 'assetId'],
      });
    }
  }
  for (const [environmentIndex, environment] of catalog.environments.entries()) {
    for (const [layerIndex, layer] of environment.layers.entries()) {
      if (!assetIds.has(layer.assetId)) context.addIssue({
        code: 'custom', message: `Environment references unknown asset ${layer.assetId}`,
        path: ['environments', environmentIndex, 'layers', layerIndex, 'assetId'],
      });
    }
  }
  const poseClipIds = new Set(catalog.poseClips.map(clip => clip.id));
  for (const [entityIndex, entity] of catalog.entityDefinitions.entries()) {
    for (const [clipIndex, clipId] of entity.poseClipIds.entries()) {
      if (!poseClipIds.has(clipId)) context.addIssue({
        code: 'custom', message: `EntityDefinition references unknown PoseClip ${clipId}`,
        path: ['entityDefinitions', entityIndex, 'poseClipIds', clipIndex],
      });
    }
  }
});

export type ResolvedAssetCatalog = z.infer<typeof ResolvedAssetCatalogSchema>;
