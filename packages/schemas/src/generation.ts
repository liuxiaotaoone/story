import {z} from 'zod';
import {VisualAssetKindSchema} from './asset.js';
import {ContentHashSchema, IdSchema} from './common.js';
import {canonicalHash} from './hash.js';
import {DirectionSchema} from './pose-clip.js';

export const GenerationReferenceAssetSchema = z.object({
  assetId: IdSchema,
  contentHash: ContentHashSchema,
}).strict();

export const RuntimeModelRoleSchema = z.enum([
  'diffusion-model',
  'text-encoder',
  'vae',
]);

export const RuntimeModelDependencySchema = z.object({
  role: RuntimeModelRoleSchema,
  modelId: IdSchema,
  contentHash: ContentHashSchema,
}).strict();

export const GenerationOutputSpecSchema = z.object({
  assetId: IdSchema,
  kind: VisualAssetKindSchema,
  nodeId: IdSchema,
  expectedCount: z.literal(1),
}).strict();

const ActionGenerationRequestPayloadShape = {
  schemaVersion: z.literal('1.0.0'),
  actionPackageId: IdSchema,
  entityType: IdSchema,
  action: IdSchema,
  direction: DirectionSchema,
  workflowId: IdSchema,
  workflowHash: ContentHashSchema,
  provider: z.literal('comfyui'),
  runtimeModels: z.array(RuntimeModelDependencySchema).min(1),
  prompt: z.string().trim().min(1),
  negativePrompt: z.string().trim().min(1).optional(),
  seed: z.number().int().nonnegative().safe(),
  referenceAssets: z.array(GenerationReferenceAssetSchema),
  output: GenerationOutputSpecSchema,
} as const;

function validateUniqueReferences(
  request: {
    referenceAssets: Array<{assetId: string}>;
    runtimeModels: Array<{role: string; modelId: string}>;
  },
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
  const roles = new Set<string>();
  const modelIds = new Set<string>();
  for (const [index, model] of request.runtimeModels.entries()) {
    if (roles.has(model.role)) context.addIssue({
      code: 'custom', message: `Duplicate runtime model role: ${model.role}`, path: ['runtimeModels', index, 'role'],
    });
    if (modelIds.has(model.modelId)) context.addIssue({
      code: 'custom', message: `Duplicate runtime model id: ${model.modelId}`, path: ['runtimeModels', index, 'modelId'],
    });
    roles.add(model.role);
    modelIds.add(model.modelId);
  }
  for (const requiredRole of RuntimeModelRoleSchema.options) {
    if (!roles.has(requiredRole)) context.addIssue({
      code: 'custom',
      message: `Missing required runtime model role: ${requiredRole}`,
      path: ['runtimeModels'],
    });
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
export type RuntimeModelRole = z.infer<typeof RuntimeModelRoleSchema>;
export type RuntimeModelDependency = z.infer<typeof RuntimeModelDependencySchema>;
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
