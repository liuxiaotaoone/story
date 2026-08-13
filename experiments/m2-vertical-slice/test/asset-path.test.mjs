import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {isPathInsideRoot} from '../vite.config.mjs';

describe('M2 asset source path boundary', () => {
  const root = resolve('asset-root');

  it('accepts descendants on the host platform', () => {
    expect(isPathInsideRoot(root, resolve(root, 'normalized', 'rabbit.png'))).toBe(true);
  });

  it('rejects sibling traversal and absolute paths outside the root', () => {
    expect(isPathInsideRoot(root, resolve(root, '..', 'secret.png'))).toBe(false);
    expect(isPathInsideRoot(root, resolve(root, '..', 'other', 'asset.png'))).toBe(false);
  });
});
