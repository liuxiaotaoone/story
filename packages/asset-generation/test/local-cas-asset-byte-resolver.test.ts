import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  contentAddressedAssetUri,
  sha256Bytes,
  type VisualAssetRecord,
} from '@pose-clip/schemas';
import {
  LocalCasAssetByteResolver,
  LocalCasAssetResolutionError,
} from '../src/local-cas-asset-byte-resolver.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, {recursive: true, force: true})));
});

async function fixture(): Promise<{asset: VisualAssetRecord; bytes: Uint8Array; root: string}> {
  const root = await mkdtemp(join(tmpdir(), 'pose-clip-cas-resolver-'));
  roots.push(root);
  const bytes = new TextEncoder().encode('local cas bytes');
  const contentHash = await sha256Bytes(bytes);
  await writeFile(join(root, `${contentHash}.png`), bytes);
  return {
    root,
    bytes,
    asset: {
      id: 'rabbit.frame', kind: 'animal-frame', uri: contentAddressedAssetUri(contentHash),
      contentHash, source: 'manual', qaStatus: 'passed', width: 1, height: 1, alphaMode: 'straight',
    },
  };
}

describe('LocalCasAssetByteResolver', () => {
  it('maps an asset identity to raw local bytes without claiming they are trusted', async () => {
    const {asset, bytes, root} = await fixture();
    await expect(new LocalCasAssetByteResolver(root).resolve(asset)).resolves.toEqual({
      bytes,
      mediaType: 'image/png',
    });
  });

  it('rejects a non-CAS physical URI', async () => {
    const {asset, root} = await fixture();
    await expect(new LocalCasAssetByteResolver(root).resolve({...asset, uri: 'C:/mutable/rabbit.png'}))
      .rejects.toBeInstanceOf(LocalCasAssetResolutionError);
  });
});
