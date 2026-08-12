import type {VisualAssetRecord} from '@pose-clip/schemas';
import assetPackage from '../manifests/compiled-asset-package.json' with {type: 'json'};

type ImportedAsset = {
  id: string;
  kind: string;
  file: string;
  contentHash: string;
  qaStatus: string;
  width: number;
  height: number;
  reviewStatus?: string;
  visualReview?: unknown;
};

const byFile = new Map((assetPackage.assets as ImportedAsset[]).map(asset => [asset.file, asset]));

export function importedVisualAsset(
  id: string,
  kind: VisualAssetRecord['kind'],
  file: string,
  alphaMode: VisualAssetRecord['alphaMode'] = 'straight',
): VisualAssetRecord {
  const imported = byFile.get(file);
  if (imported === undefined) throw new Error(`Asset package has no ${file}`);
  return {
    id,
    kind,
    uri: new URL(`/${file}`, location.href).href,
    contentHash: imported.contentHash,
    source: 'generated',
    provenance: {
      inputHash: imported.contentHash,
      promptHash: imported.contentHash,
      modelId: kind === 'prop' && file.endsWith('shadow.png') ? 'deterministic-pillow' : 'imagegen',
      modelVersion: '2026-08-12',
      workflowVersion: '1.0.0',
      producer: {name: 'asset-package-importer', version: '0.1.0'},
      createdAt: '2026-08-12T00:00:00.000Z',
    },
    qaStatus: imported.qaStatus === 'passed' ? 'passed' : imported.qaStatus === 'warning' ? 'warning' : 'failed',
    width: imported.width,
    height: imported.height,
    alphaMode,
  };
}

export const importedPackageDecision = {
  automatedStructuralQa: assetPackage.automatedStructuralQa,
  humanVisualReview: assetPackage.humanVisualReview,
  productionReady: assetPackage.productionReady,
  packageHash: assetPackage.packageHash,
};
