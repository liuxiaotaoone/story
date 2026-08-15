import {
  ActionGenerationRequestSchema,
  actionGenerationRequestPayload,
  hashActionGenerationRequestPayload,
  type ActionGenerationRequest,
} from '@pose-clip/schemas';

export class AssetGenerationIntegrityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'AssetGenerationIntegrityError';
  }
}

export class AssetGenerationTransientError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'AssetGenerationTransientError';
  }
}

export async function assertGenerationRequestIntegrity(
  input: ActionGenerationRequest,
): Promise<ActionGenerationRequest> {
  const request = ActionGenerationRequestSchema.parse(input);
  const computed = await hashActionGenerationRequestPayload(actionGenerationRequestPayload(request));
  if (computed !== request.inputHash) {
    throw new AssetGenerationIntegrityError(
      'GENERATION_REQUEST_HASH_MISMATCH',
      `Generation Request ${request.actionPackageId}/${request.direction} does not match inputHash`,
    );
  }
  return request;
}
