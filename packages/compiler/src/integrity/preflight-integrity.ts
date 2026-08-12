import {
  PreflightCompileResultSchema,
  canonicalHash,
  type PreflightCompileResult,
} from '@pose-clip/schemas';
import {CompileIntegrityError} from './hash-integrity.js';

export type PreflightCompileResultPayload = Omit<PreflightCompileResult, 'preflightHash'>;

export async function hashPreflightCompileResultPayload(payload: PreflightCompileResultPayload): Promise<string> {
  return canonicalHash('preflight-result-v1', payload);
}

export async function assertPreflightCompileResultIntegrity(input: PreflightCompileResult): Promise<PreflightCompileResult> {
  const preflight = PreflightCompileResultSchema.parse(input);
  const {preflightHash, ...payload} = preflight;
  const computedHash = await hashPreflightCompileResultPayload(payload);
  if (computedHash !== preflightHash) {
    throw new CompileIntegrityError('PreflightCompileResult content does not match preflightHash');
  }
  return preflight;
}
