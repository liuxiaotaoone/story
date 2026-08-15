import {Assets, Texture} from 'pixi.js';
import type {RenderPlan, VisualAssetRecord} from '@pose-clip/schemas';
import {VerifiedAssetResolver, type VerifiedAsset} from '../assets/verified-asset-resolver.js';

export type TextureLoader = (asset: Readonly<VisualAssetRecord>, verified: Readonly<VerifiedAsset>) => Promise<Texture>;

function textureAlias(asset: Readonly<VisualAssetRecord>): string {
  return `paper:${asset.id}:${asset.contentHash}`;
}

function textureFormat(mediaType: string | undefined): string {
  switch (mediaType?.toLowerCase()) {
    case 'image/svg+xml': return 'svg';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    default: return 'png';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function defaultTextureLoader(asset: Readonly<VisualAssetRecord>, verified: Readonly<VerifiedAsset>): Promise<Texture> {
  const mediaType = verified.mediaType ?? 'image/png';
  const format = textureFormat(mediaType);
  const src = `data:${mediaType};base64,${bytesToBase64(verified.bytes)}`;
  return Assets.load<Texture>({
    alias: textureAlias(asset),
    src,
    format,
    parser: format === 'svg' ? 'svg' : 'texture',
  });
}

export interface TextureCacheOptions {
  readonly resolver?: VerifiedAssetResolver;
  readonly loader?: TextureLoader;
}

export class TextureCache {
  readonly #textures = new Map<string, Texture>();
  readonly #assets = new Map<string, VisualAssetRecord>();
  readonly #resolver: VerifiedAssetResolver;
  readonly #loader: TextureLoader;

  constructor(options: TextureCacheOptions = {}) {
    this.#resolver = options.resolver ?? new VerifiedAssetResolver();
    this.#loader = options.loader ?? defaultTextureLoader;
  }

  async preload(plan: Readonly<RenderPlan>): Promise<void> {
    const visualAssets = plan.assets.assets.filter((asset): asset is VisualAssetRecord => 'width' in asset);
    await Promise.all(visualAssets.map((asset) => this.load(asset)));
  }

  async load(asset: VisualAssetRecord): Promise<Texture> {
    const existing = this.#textures.get(asset.id);
    if (existing !== undefined) {
      const loadedAsset = this.#assets.get(asset.id)!;
      if (loadedAsset.contentHash !== asset.contentHash) {
        throw new Error(`Texture ${asset.id} was already loaded with a different contentHash`);
      }
      return existing;
    }
    const verified = await this.#resolver.resolve(asset);
    const texture = await this.#loader(asset, verified);
    this.#textures.set(asset.id, texture);
    this.#assets.set(asset.id, asset);
    return texture;
  }

  get(assetId: string): Texture {
    const texture = this.#textures.get(assetId);
    if (texture === undefined) throw new Error(`Texture ${assetId} was not preloaded`);
    return texture;
  }

  has(assetId: string): boolean {
    return this.#textures.has(assetId);
  }

  get size(): number {
    return this.#textures.size;
  }

  async destroy(): Promise<void> {
    const aliases = [...this.#assets.values()].map(textureAlias);
    this.#textures.clear();
    this.#assets.clear();
    await Promise.all(aliases.map(async (alias) => Assets.unload(alias).catch(() => undefined)));
  }
}
