import {Container, Texture} from 'pixi.js';
import type {CameraState, SpriteRenderState, VisualAssetRecord} from '@pose-clip/schemas';
import {describe, expect, it, vi} from 'vitest';
import {resolveSpriteForPixi} from '../src/camera/apply-camera-transform.js';
import {SpriteRegistry} from '../src/sprites/sprite-registry.js';
import {TextureCache} from '../src/textures/texture-cache.js';

const visualAsset: VisualAssetRecord = {
  id: 'farmer-idle',
  kind: 'character-frame',
  uri: 'memory://farmer-idle',
  contentHash: 'a'.repeat(64),
  source: 'manual',
  qaStatus: 'passed',
  width: 240,
  height: 400,
  alphaMode: 'premultiplied',
  attachmentAnchors: [{id: 'foot', point: {x: 0.5, y: 0.95}}],
};

describe('TextureCache', () => {
  it('loads an asset once and rejects access before preload', async () => {
    const loader = vi.fn(async () => Texture.EMPTY);
    const cache = new TextureCache(loader);
    expect(() => cache.get(visualAsset.id)).toThrow('was not preloaded');
    await cache.load(visualAsset);
    await cache.load(visualAsset);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get(visualAsset.id)).toBe(Texture.EMPTY);
  });
});

describe('SpriteRegistry', () => {
  it('reuses renderIds and appends sprites in canonical input order', () => {
    const root = new Container();
    const registry = new SpriteRegistry(root);
    const first = registry.acquire('render:a', 'asset:a', Texture.EMPTY);
    const second = registry.acquire('render:b', 'asset:b', Texture.EMPTY);
    expect(registry.acquire('render:a', 'asset:a', Texture.EMPTY)).toBe(first);
    registry.beginFrame();
    registry.appendInCanonicalOrder(second);
    registry.appendInCanonicalOrder(first);
    expect(root.children.map(child => child.label)).toEqual(['render:b', 'render:a']);
    registry.prune(new Set(['render:a']));
    expect(registry.size).toBe(1);
  });
});

describe('resolveSpriteForPixi', () => {
  it('delegates world camera math in canonical 1280x720 space', () => {
    const sprite = {
      transform: {position: {x: 740, y: 360}, scale: {x: 1, y: 1}, rotation: 0.5, opacity: 0.75},
      cameraSpace: {kind: 'world', influence: 1},
    } as SpriteRenderState;
    const camera: CameraState = {position: {x: 640, y: 360}, zoom: 2, rotation: 0};
    expect(resolveSpriteForPixi(sprite, camera)).toEqual({
      position: {x: 840, y: 360},
      scale: {x: 2, y: 2},
      rotation: 0.5,
      opacity: 0.75,
    });
  });
});
