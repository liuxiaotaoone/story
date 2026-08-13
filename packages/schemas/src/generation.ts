import {z} from 'zod';
import {VisualAssetKindSchema} from './asset.js';
import {ContentHashSchema, IdSchema} from './common.js';
import {canonicalHash} from './hash.js';
import {DirectionSchema} from './pose-clip.js';

export const GenerationReferenceAssetSchema = z.object({
  assetId: IdSchema,
  contentHash: ContentHashSchema,
}).strict();

export const GenerationModelSchema = z.object({
  provider: z.literal('comfyui'),
  modelId: IdSchema,
  modelHash: ContentHashSchema.optional(),
}).strict();

export const GenerationOutputSpecSchema = z.object({
  assetId: IdSchema,
  kind: VisualAssetKindSchema,
}).strict();

const ActionGenerationRequestPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  actionPackageId: IdSchema,
  entityType: IdSchema,
  action: IdSchema,
  direction: DirectionSchema,
  workflowId: IdSchema,
  workflowHash: ContentHashSchema,
  model: GenerationModelSchema,
  prompt: z.string().trim().min(1),
  negativePrompt: z.string().trim().min(1).optional(),
  seed: z.number().int().nonnegative().safe(),
  referenceAssets: z.array(GenerationReferenceAssetSchema),
  output: GenerationOutputSpecSchema,
} as const;

function validateUniqueReferences(
  request: {referenceAssets: Array<{assetId: string}>},
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  for (const [index, reference] of request.referenceAssets.entries()) {
    if (ids.has(reference.assetId)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate generation reference asset: ${reference.assetId}`,
        path: ['referenceAssets', index, 'assetId'],
      });
    }
    ids.add(reference.assetId);
  }
}

export const ActionGenerationRequestPayloadSchema = z.object(
  ActionGenerationRequestPayloadShape,
).strict().superRefine(validateUniqueReferences);

export const ActionGenerationRequestSchema = z.object({
  ...ActionGenerationRequestPayloadShape,
  inputHash: ContentHashSchema,
}).strict().superRefine(validateUniqueReferences);

export type GenerationReferenceAsset = z.infer<typeof GenerationReferenceAssetSchema>;
export type GenerationModel = z.infer<typeof GenerationModelSchema>;
export type GenerationOutputSpec = z.infer<typeof GenerationOutputSpecSchema>;
export type ActionGenerationRequestPayload = z.infer<typeof ActionGenerationRequestPayloadSchema>;
export type ActionGenerationRequest = z.infer<typeof ActionGenerationRequestSchema>;

export async function hashActionGenerationRequestPayload(
  input: ActionGenerationRequestPayload,
): Promise<string> {
  return canonicalHash('action-generation-request-v1', ActionGenerationRequestPayloadSchema.parse(input));
}

export async function createActionGenerationRequest(
  input: ActionGenerationRequestPayload,
): Promise<ActionGenerationRequest> {
  const payload = ActionGenerationRequestPayloadSchema.parse(input);
  return ActionGenerationRequestSchema.parse({
    ...payload,
    inputHash: await hashActionGenerationRequestPayload(payload),
  });
}

export function actionGenerationRequestPayload(
  request: ActionGenerationRequest,
): ActionGenerationRequestPayload {
  const {inputHash: _inputHash, ...payload} = ActionGenerationRequestSchema.parse(request);
  return ActionGenerationRequestPayloadSchema.parse(payload);
}
