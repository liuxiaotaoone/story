import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {
  contentAddressedAssetUri,
  type VisualAssetRecord,
} from '@pose-clip/schemas';

export interface LocalCasResolvedAssetBytes {
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png';
}

export class LocalCasAssetResolutionError extends Error {
  constructor(message: string, readonly assetId: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalCasAssetResolutionError';
  }
}

/** Maps a logical asset:// SHA-256 identity to an untrusted local PNG byte source. */
export class LocalCasAssetByteResolver {
  readonly #root: string;

  constructor(root: string) {
    if (root.trim().length === 0) throw new TypeError('Local CAS root must not be empty');
    this.#root = resolve(root);
  }

  async resolve(asset: Readonly<VisualAssetRecord>): Promise<LocalCasResolvedAssetBytes> {
    const expectedUri = contentAddressedAssetUri(asset.contentHash);
    if (asset.uri !== expectedUri) {
      throw new LocalCasAssetResolutionError(
        `Local CAS asset ${asset.id} must use ${expectedUri}`,
        asset.id,
      );
    }
    const path = join(this.#root, `${asset.contentHash}.png`);
    try {
      return {bytes: new Uint8Array(await readFile(path)), mediaType: 'image/png'};
    } catch (error) {
      throw new LocalCasAssetResolutionError(
        `Local CAS asset ${asset.id} could not be read`,
        asset.id,
        {cause: error},
      );
    }
  }
}
