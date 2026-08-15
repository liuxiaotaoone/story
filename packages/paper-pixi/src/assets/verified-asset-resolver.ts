import {
  sha256Bytes,
  type ContentHash,
  type VisualAssetRecord,
} from '@pose-clip/schemas';

export interface ResolvedAssetBytes {
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
}

export interface VerifiedAsset {
  readonly assetId: string;
  readonly contentHash: ContentHash;
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
}

export type AssetByteResolver = (asset: Readonly<VisualAssetRecord>) => Promise<ResolvedAssetBytes>;

export class AssetIntegrityError extends Error {
  constructor(
    message: string,
    readonly assetId: string,
    readonly expectedHash: string,
    readonly actualHash?: string,
  ) {
    super(message);
    this.name = 'AssetIntegrityError';
  }
}

async function fetchAssetBytes(asset: Readonly<VisualAssetRecord>): Promise<ResolvedAssetBytes> {
  if (asset.uri.startsWith('asset://')) {
    throw new AssetIntegrityError(
      `Content-addressed asset ${asset.id} requires a physical AssetByteResolver`,
      asset.id,
      asset.contentHash,
    );
  }
  const response = await fetch(asset.uri);
  if (!response.ok) {
    throw new AssetIntegrityError(
      `Asset ${asset.id} could not be read from ${asset.uri}: HTTP ${response.status}`,
      asset.id,
      asset.contentHash,
    );
  }
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    ...(mediaType === undefined || mediaType.length === 0 ? {} : {mediaType}),
  };
}

/** Resolves physical bytes and promotes them to a trusted asset only after SHA-256 verification. */
export class VerifiedAssetResolver {
  readonly #resolveBytes: AssetByteResolver;

  constructor(resolveBytes: AssetByteResolver = fetchAssetBytes) {
    this.#resolveBytes = resolveBytes;
  }

  async resolve(asset: Readonly<VisualAssetRecord>): Promise<VerifiedAsset> {
    const resolved = await this.#resolveBytes(asset);
    const bytes = Uint8Array.from(resolved.bytes);
    const actualHash = await sha256Bytes(bytes);
    if (actualHash !== asset.contentHash) {
      throw new AssetIntegrityError(
        `Asset ${asset.id} SHA-256 mismatch: expected ${asset.contentHash}, received ${actualHash}`,
        asset.id,
        asset.contentHash,
        actualHash,
      );
    }
    return {
      assetId: asset.id,
      contentHash: asset.contentHash,
      bytes,
      ...(resolved.mediaType === undefined ? {} : {mediaType: resolved.mediaType}),
    };
  }
}
