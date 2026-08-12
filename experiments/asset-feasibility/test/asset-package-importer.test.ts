import {describe, expect, it} from 'vitest';
import {loadAssetPackage} from '../src/asset-package-importer.js';

describe('asset package importer modes', () => {
  it('allows a non-production-ready package in experiment mode', () => {
    const assetPackage = loadAssetPackage({mode: 'experiment'});
    expect(assetPackage.productionReady).toBe(false);
  });

  it('rejects a non-production-ready package in production mode', () => {
    expect(() => loadAssetPackage({mode: 'production'})).toThrow(/not production-ready/i);
  });
});
