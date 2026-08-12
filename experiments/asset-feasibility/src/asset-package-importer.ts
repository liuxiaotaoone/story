import type {AssetProvenance, VisualAssetRecord} from '@pose-clip/schemas';
import assetPackage from '../manifests/compiled-asset-package.json' with {type: 'json'};

export type AssetPackageMode = 'experiment' | 'production';

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
  provenance: AssetProvenance;
};

type ImportedAssetPackage = Omit<typeof assetPackage, 'assets'> & {assets: ImportedAsset[]};

export function loadAssetPackage(options: {mode: AssetPackageMode}): ImportedAssetPackage {
  const imported = assetPackage as ImportedAssetPackage;
  if (options.mode === 'production' && !imported.productionReady) {
    throw new Error('Asset package is not production-ready; complete human visual and anchor review first');
  }
  return imported;
}

const importedPackage = loadAssetPackage({mode: 'experiment'});
const byFile = new Map(importedPackage.assets.map(asset => [asset.file, asset]));

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
    provenance: imported.provenance,
    qaStatus: imported.qaStatus === 'passed' ? 'passed' : imported.qaStatus === 'warning' ? 'warning' : 'failed',
    width: imported.width,
    height: imported.height,
    alphaMode,
  };
}

export const importedPackageDecision = {
  mode: 'experiment' as const,
  automatedStructuralQa: importedPackage.automatedStructuralQa,
  humanVisualReview: importedPackage.humanVisualReview,
  productionReady: importedPackage.productionReady,
  packageHash: importedPackage.packageHash,
};
