import type {JsonValue} from '@pose-clip/schemas';

const ALLOWED_ROOTS = new Set(['actions', 'cameraIntents', 'narration', 'blockingIntents', 'shots']);

function decodeSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function directorOverridePathSegments(path: string): string[] {
  if (!path.startsWith('/')) throw new Error('Override path must be a JSON Pointer');
  const segments = path.slice(1).split('/').map(decodeSegment);
  if (segments.length < 2 || !ALLOWED_ROOTS.has(segments[0] ?? '')) {
    throw new Error(`Override path root is not allowed: ${path}`);
  }
  return segments;
}

function parentAt(root: JsonValue, segments: string[]): {parent: JsonValue[] | {[key: string]: JsonValue}; key: string} {
  let current: JsonValue = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) throw new Error(`Invalid array index: ${segment}`);
      current = current[index]!;
    } else if (current !== null && typeof current === 'object') {
      if (!(segment in current)) throw new Error(`Missing override path segment: ${segment}`);
      current = current[segment]!;
    } else {
      throw new Error(`Cannot traverse override path segment: ${segment}`);
    }
  }
  if (current === null || typeof current !== 'object') throw new Error('Override target parent is not a container');
  return {parent: current, key: segments.at(-1)!};
}

export function applyJsonPointerOperation(
  document: JsonValue,
  operation: 'replace' | 'remove' | 'insert',
  path: string,
  value?: JsonValue,
): void {
  const {parent, key} = parentAt(document, directorOverridePathSegments(path));
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid array index: ${key}`);
    if (operation === 'insert') {
      if (index > parent.length || value === undefined) throw new Error(`Invalid array insert: ${path}`);
      parent.splice(index, 0, value);
      return;
    }
    if (index >= parent.length) throw new Error(`Array target does not exist: ${path}`);
    if (operation === 'remove') parent.splice(index, 1);
    else {
      if (value === undefined) throw new Error(`replace requires value: ${path}`);
      parent[index] = value;
    }
    return;
  }
  if (operation === 'insert') throw new Error('insert is only supported for DirectorPlan arrays');
  if (!(key in parent)) throw new Error(`Object target does not exist: ${path}`);
  if (operation === 'remove') delete parent[key];
  else {
    if (value === undefined) throw new Error(`replace requires value: ${path}`);
    parent[key] = value;
  }
}
