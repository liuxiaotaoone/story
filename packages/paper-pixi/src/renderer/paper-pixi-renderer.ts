import type {RenderPlan, RenderState} from '@pose-clip/schemas';
import {RenderStateSchema} from '@pose-clip/schemas';
import type {PaperPixiApplication} from '../application/create-application.js';
import {resolveSpriteForPixi} from '../camera/apply-camera-transform.js';
import {SpriteRegistry} from '../sprites/sprite-registry.js';
import {TextureCache} from '../textures/texture-cache.js';

export class PaperPixiRenderer {
  readonly #application: PaperPixiApplication;
  readonly #textures: TextureCache;
  readonly #sprites: SpriteRegistry;
  #lastState?: RenderState;

  constructor(application: PaperPixiApplication, textures = new TextureCache()) {
    this.#application = application;
    this.#textures = textures;
    this.#sprites = new SpriteRegistry(application.root);
  }

  async preload(plan: Readonly<RenderPlan>): Promise<void> {
    await this.#textures.preload(plan);
  }

  apply(input: RenderState): void {
    const state = RenderStateSchema.parse(input);
    this.#sprites.beginFrame();
    for (const spriteState of state.sprites) {
      const sprite = this.#sprites.acquire(spriteState.renderId, spriteState.assetId, this.#textures.get(spriteState.assetId));
      const transform = resolveSpriteForPixi(spriteState, state.camera);
      sprite.anchor.set(spriteState.anchor.x, spriteState.anchor.y);
      sprite.position.set(transform.position.x, transform.position.y);
      sprite.scale.set(transform.scale.x, transform.scale.y);
      sprite.rotation = transform.rotation;
      sprite.alpha = transform.opacity;
      sprite.visible = spriteState.visible;
      this.#sprites.appendInCanonicalOrder(sprite);
    }
    // Keep inactive sprites cached for cross-frame reuse; explicit prune remains available.
    this.#lastState = state;
    this.#application.app.render();
  }

  prune(): void {
    this.#sprites.prune(new Set(this.#lastState?.sprites.map(({renderId}) => renderId) ?? []));
  }

  get lastState(): RenderState | undefined {
    return this.#lastState;
  }

  get spriteRegistry(): SpriteRegistry {
    return this.#sprites;
  }

  get textureCache(): TextureCache {
    return this.#textures;
  }

  async destroy(): Promise<void> {
    this.#sprites.destroy();
    await this.#textures.destroy();
    this.#application.destroy();
  }
}
