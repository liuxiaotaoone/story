import {Assets, Texture} from 'pixi.js';
import type {RenderPlan, VisualAssetRecord} from '@pose-clip/schemas';

export type TextureLoader = (asset: VisualAssetRecord) => Promise<Texture>;

async function defaultTextureLoader(asset: VisualAssetRecord): Promise<Texture> {
  return Assets.load<Texture>({alias: `paper:${asset.id}`, src: asset.uri});
}

export class TextureCache {
  readonly #textures = new Map<string, Texture>();
  readonly #assets = new Map<string, VisualAssetRecord>();
  readonly #loader: TextureLoader;

  constructor(loader: TextureLoader = defaultTextureLoader) {
    this.#loader = loader;
  }

  async preload(plan: Readonly<RenderPlan>): Promise<void> {
    const visualAssets = plan.assets.assets.filter((asset): asset is VisualAssetRecord => 'width' in asset);
    await Promise.all(visualAssets.map((asset) => this.load(asset)));
  }

  async load(asset: VisualAssetRecord): Promise<Texture> {
    const existing = this.#textures.get(asset.id);
    if (existing !== undefined) return existing;
    const texture = await this.#loader(asset);
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
    const aliases = [...this.#assets.values()].map((asset) => `paper:${asset.id}`);
    this.#textures.clear();
    this.#assets.clear();
    await Promise.all(aliases.map(async (alias) => Assets.unload(alias).catch(() => undefined)));
  }
}
