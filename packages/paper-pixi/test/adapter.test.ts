import {Container, Texture} from 'pixi.js';
import type {CameraState, SpriteRenderState, VisualAssetRecord} from '@pose-clip/schemas';
import {sha256Bytes} from '@pose-clip/schemas';
import {describe, expect, it, vi} from 'vitest';
import {AssetIntegrityError, VerifiedAssetResolver} from '../src/assets/verified-asset-resolver.js';
import {resolveSpriteForPixi} from '../src/camera/apply-camera-transform.js';
import {SpriteRegistry} from '../src/sprites/sprite-registry.js';
import {TextureCache} from '../src/textures/texture-cache.js';

const ASSET_BYTES = new TextEncoder().encode('trusted visual asset bytes');

async function visualAsset(): Promise<VisualAssetRecord> {
  return {
  id: 'farmer-idle',
  kind: 'character-frame',
  uri: 'asset://sha256/pending',
  contentHash: await sha256Bytes(ASSET_BYTES),
  source: 'manual',
  qaStatus: 'passed',
  width: 240,
  height: 400,
  alphaMode: 'premultiplied',
  attachmentAnchors: [{id: 'foot', point: {x: 0.5, y: 0.95}}],
  };
}

describe('TextureCache', () => {
  it('verifies bytes, loads an asset once and rejects access before preload', async () => {
    const asset = await visualAsset();
    const byteResolver = vi.fn(async () => ({bytes: ASSET_BYTES, mediaType: 'image/png'}));
    const loader = vi.fn(async () => Texture.EMPTY);
    const cache = new TextureCache({resolver: new VerifiedAssetResolver(byteResolver), loader});
    expect(() => cache.get(asset.id)).toThrow('was not preloaded');
    await cache.load(asset);
    await cache.load(asset);
    expect(byteResolver).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(asset, expect.objectContaining({
      assetId: asset.id,
      contentHash: asset.contentHash,
      bytes: ASSET_BYTES,
    }));
    expect(cache.get(asset.id)).toBe(Texture.EMPTY);
  });

  it('fails before texture creation when resolved bytes do not match contentHash', async () => {
    const asset = await visualAsset();
    const loader = vi.fn(async () => Texture.EMPTY);
    const cache = new TextureCache({
      resolver: new VerifiedAssetResolver(async () => ({bytes: new TextEncoder().encode('tampered')})),
      loader,
    });
    await expect(cache.load(asset)).rejects.toBeInstanceOf(AssetIntegrityError);
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects content identity drift for an already cached asset id', async () => {
    const asset = await visualAsset();
    const cache = new TextureCache({
      resolver: new VerifiedAssetResolver(async () => ({bytes: ASSET_BYTES})),
      loader: async () => Texture.EMPTY,
    });
    await cache.load(asset);
    await expect(cache.load({...asset, contentHash: 'f'.repeat(64)})).rejects.toThrow(
      'already loaded with a different contentHash',
    );
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
