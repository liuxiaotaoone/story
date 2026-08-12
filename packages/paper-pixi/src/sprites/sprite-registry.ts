import {Container, Sprite, type Texture} from 'pixi.js';

export class SpriteRegistry {
  readonly #sprites = new Map<string, Sprite>();
  readonly #assetIds = new Map<string, string>();
  readonly #root: Container;

  constructor(root: Container) {
    this.#root = root;
  }

  acquire(renderId: string, assetId: string, texture: Texture): Sprite {
    let sprite = this.#sprites.get(renderId);
    if (sprite === undefined) {
      sprite = new Sprite(texture);
      sprite.label = renderId;
      this.#sprites.set(renderId, sprite);
      this.#assetIds.set(renderId, assetId);
      return sprite;
    }
    if (this.#assetIds.get(renderId) !== assetId) {
      sprite.texture = texture;
      this.#assetIds.set(renderId, assetId);
    }
    return sprite;
  }

  beginFrame(): void {
    this.#root.removeChildren();
    for (const sprite of this.#sprites.values()) sprite.visible = false;
  }

  appendInCanonicalOrder(sprite: Sprite): void {
    this.#root.addChild(sprite);
  }

  get(renderId: string): Sprite | undefined {
    return this.#sprites.get(renderId);
  }

  get size(): number {
    return this.#sprites.size;
  }

  prune(keepRenderIds: ReadonlySet<string>): void {
    for (const [renderId, sprite] of this.#sprites) {
      if (keepRenderIds.has(renderId)) continue;
      sprite.destroy({texture: false, textureSource: false});
      this.#sprites.delete(renderId);
      this.#assetIds.delete(renderId);
    }
  }

  destroy(): void {
    for (const sprite of this.#sprites.values()) sprite.destroy({texture: false, textureSource: false});
    this.#sprites.clear();
    this.#assetIds.clear();
    this.#root.removeChildren();
  }
}
