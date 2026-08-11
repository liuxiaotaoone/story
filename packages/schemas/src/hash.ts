export const CANONICAL_JSON_VERSION = 'canonical-json-v1' as const;
export const CONTENT_HASH_ALGORITHM = 'sha256' as const;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not allow non-finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareCodeUnits);
    const entries = keys.map((key) => {
      const item = record[key];
      if (item === undefined) throw new TypeError(`Canonical JSON does not allow undefined at key ${key}`);
      return `${JSON.stringify(key)}:${canonicalizeJson(item)}`;
    });
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`Canonical JSON does not allow ${typeof value}`);
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const canonical = canonicalizeJson(value);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function canonicalHash(domain: string, payload: unknown): Promise<string> {
  if (domain.trim().length === 0) throw new TypeError('Canonical hash domain must not be empty');
  return sha256Canonical({
    canonicalVersion: CANONICAL_JSON_VERSION,
    domain,
    payload,
  });
}
