import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

interface Admission {
  workflow: {id: string; contentHash: string};
  modelCatalogHash: string;
  referenceAsset: {contentHash: string};
  productionRequestHash: string;
  trustedProfileHash: string;
  frameExecutionKeys: string[];
}

interface PassManifest {
  status: string;
  admission: {
    workflowId: string;
    workflowHash: string;
    modelCatalogHash: string;
    referenceAssetHash: string;
    productionRequestHash: string;
    trustedProfileHash: string;
  };
  frames: Array<{
    frameIndex: number;
    attemptCount: number;
    frameExecutionKey: string;
    artifacts: Record<'raw' | 'matted' | 'normalized' | 'anchored', string>;
  }>;
  continuity: {status: string; automatedReady: boolean};
  production: {
    profileApproval: string;
    humanReview: string;
    productionReady: boolean;
  };
  resourceRelease: string;
}

async function readJson<T>(path: URL): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readFile(path))) as T;
}

describe('frozen real GPU production E2E PASS manifest', () => {
  it('is bound to the admitted identities and preserves pending visual approval', async () => {
    const [admission, manifest] = await Promise.all([
      readJson<Admission>(new URL('../frozen/production-e2e-admission.json', import.meta.url)),
      readJson<PassManifest>(new URL('../frozen/production-e2e-pass-manifest.json', import.meta.url)),
    ]);

    expect(manifest.status).toBe('PASS');
    expect(manifest.admission).toEqual({
      workflowId: admission.workflow.id,
      workflowHash: admission.workflow.contentHash,
      modelCatalogHash: admission.modelCatalogHash,
      referenceAssetHash: admission.referenceAsset.contentHash,
      productionRequestHash: admission.productionRequestHash,
      trustedProfileHash: admission.trustedProfileHash,
    });
    expect(manifest.frames.map(frame => frame.frameExecutionKey)).toEqual(admission.frameExecutionKeys);
    expect(manifest.frames.map(frame => frame.frameIndex)).toEqual([0, 1, 2, 3]);
    expect(manifest.frames.every(frame => frame.attemptCount === 1)).toBe(true);
    expect(manifest.frames.every(frame => Object.values(frame.artifacts).every(hash => /^[a-f0-9]{64}$/u.test(hash)))).toBe(true);
    expect(manifest.continuity).toMatchObject({status: 'PASS', automatedReady: true});
    expect(manifest.production).toMatchObject({
      profileApproval: 'pending',
      humanReview: 'pending',
      productionReady: false,
    });
    expect(manifest.resourceRelease).toBe('PASS');
  });
});
