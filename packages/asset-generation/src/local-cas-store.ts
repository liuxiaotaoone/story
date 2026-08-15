import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {contentAddressedAssetUri, sha256Bytes} from '@pose-clip/schemas';

export interface StoredCasAsset {
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly uri: string;
  readonly filePath: string;
}

export interface ContentAddressedAssetStore {
  putPng(bytes: Uint8Array): Promise<StoredCasAsset>;
}

export class LocalContentAddressedAssetStore implements ContentAddressedAssetStore {
  readonly #root: string;

  constructor(root: string) {
    if (root.trim().length === 0) throw new TypeError('Local CAS root must not be empty');
    this.#root = resolve(root);
  }

  async putPng(input: Uint8Array): Promise<StoredCasAsset> {
    const bytes = input.slice();
    const contentHash = await sha256Bytes(bytes);
    const filePath = join(this.#root, `${contentHash}.png`);
    await mkdir(this.#root, {recursive: true});
    await writeFile(filePath, bytes);
    return {
      bytes,
      contentHash,
      uri: contentAddressedAssetUri(contentHash),
      filePath,
    };
  }
}
