import {z} from 'zod';
import {AssetKindSchema, AssetProvenanceSchema} from './asset.js';
import {AttachmentModeSchema} from './attachment.js';
import {
  ActionCompletionPolicySchema,
  ActionSpatialModeSchema,
  ActionTargetPolicySchema,
} from './capability.js';
import {ContentHashSchema, IdSchema} from './common.js';
import {ActionInteractionSchema} from './interaction.js';
import {DirectionSchema} from './pose-clip.js';

export const ActionPackageVariantSchema = z.object({
  direction: DirectionSchema,
  poseClipId: IdSchema,
}).strict();

export const ActionPackageAssetRequirementSchema = z.object({
  assetId: IdSchema,
  kind: AssetKindSchema,
  role: z.enum(['pose-frame', 'effect', 'prop', 'reference', 'audio']),
}).strict();

export const ActionPackageQaDiagnosticSchema = z.object({
  code: IdSchema,
  severity: z.enum(['warning', 'error']),
  message: z.string().trim().min(1),
}).strict();

export const ActionPackageQaSchema = z.object({
  structural: z.enum(['pending', 'passed', 'warning', 'failed']),
  continuity: z.enum(['pending', 'passed', 'warning', 'failed']),
  anchors: z.enum(['pending', 'passed', 'warning', 'failed']),
  humanReview: z.enum(['pending', 'approved', 'rejected']),
  productionReady: z.boolean(),
  diagnostics: z.array(ActionPackageQaDiagnosticSchema),
}).strict().superRefine((qa, context) => {
  if (qa.productionReady && (
    qa.structural !== 'passed'
    || qa.continuity !== 'passed'
    || qa.anchors !== 'passed'
    || qa.humanReview !== 'approved'
    || qa.diagnostics.some(diagnostic => diagnostic.severity === 'error')
  )) context.addIssue({
    code: 'custom',
    message: 'productionReady requires passed automated QA, approved human review and no error diagnostics',
    path: ['productionReady'],
  });
});

const ActionPackageShape = {
  schemaVersion: z.literal('1.0.0'),
  id: IdSchema,
  entityType: IdSchema,
  action: IdSchema,
  variants: z.array(ActionPackageVariantSchema).min(1),
  defaultDirection: DirectionSchema,
  duration: z.object({minDurationFrames: z.number().int().positive()}).strict(),
  spatialMode: ActionSpatialModeSchema,
  completionPolicy: ActionCompletionPolicySchema,
  targetPolicy: ActionTargetPolicySchema,
  targetTypes: z.array(IdSchema).optional(),
  attachmentMode: AttachmentModeSchema.optional(),
  interaction: ActionInteractionSchema.optional(),
  requiredAssets: z.array(ActionPackageAssetRequirementSchema).min(1),
  provenance: AssetProvenanceSchema,
  qa: ActionPackageQaSchema,
} as const;

function refineActionPackage(
  actionPackage: z.output<z.ZodObject<typeof ActionPackageShape>>,
  context: z.RefinementCtx,
): void {
  const directions = new Set<string>();
  const poseClipIds = new Set<string>();
  for (const [index, variant] of actionPackage.variants.entries()) {
    if (directions.has(variant.direction)) context.addIssue({
      code: 'custom', message: `Duplicate Action Package direction: ${variant.direction}`,
      path: ['variants', index, 'direction'],
    });
    if (poseClipIds.has(variant.poseClipId)) context.addIssue({
      code: 'custom', message: `Duplicate Action Package PoseClip: ${variant.poseClipId}`,
      path: ['variants', index, 'poseClipId'],
    });
    directions.add(variant.direction);
    poseClipIds.add(variant.poseClipId);
  }
  if (!directions.has(actionPackage.defaultDirection)) context.addIssue({
    code: 'custom', message: `defaultDirection ${actionPackage.defaultDirection} has no variant`, path: ['defaultDirection'],
  });

  const assetIds = new Set<string>();
  for (const [index, asset] of actionPackage.requiredAssets.entries()) {
    if (assetIds.has(asset.assetId)) context.addIssue({
      code: 'custom', message: `Duplicate Action Package asset: ${asset.assetId}`,
      path: ['requiredAssets', index, 'assetId'],
    });
    assetIds.add(asset.assetId);
  }

  if (actionPackage.targetPolicy === 'none' && actionPackage.targetTypes !== undefined) context.addIssue({
    code: 'custom', message: 'targetPolicy=none forbids targetTypes', path: ['targetTypes'],
  });
  if (actionPackage.targetPolicy !== 'none' && actionPackage.targetTypes === undefined) context.addIssue({
    code: 'custom', message: `${actionPackage.targetPolicy} targetPolicy requires targetTypes`, path: ['targetTypes'],
  });
  if (actionPackage.targetPolicy !== 'required' && actionPackage.interaction !== undefined) context.addIssue({
    code: 'custom', message: 'Interaction requires targetPolicy=required', path: ['targetPolicy'],
  });
  if (actionPackage.interaction?.ownership !== undefined && actionPackage.attachmentMode !== 'baked') context.addIssue({
    code: 'custom', message: 'Baked ownership interaction requires attachmentMode=baked', path: ['attachmentMode'],
  });
}

export const ActionPackagePayloadSchema = z.object(ActionPackageShape).strict().superRefine(refineActionPackage);
export const ActionPackageSchema = z.object({
  ...ActionPackageShape,
  packageHash: ContentHashSchema,
}).strict().superRefine(refineActionPackage);

export type ActionPackageVariant = z.infer<typeof ActionPackageVariantSchema>;
export type ActionPackageAssetRequirement = z.infer<typeof ActionPackageAssetRequirementSchema>;
export type ActionPackageQa = z.infer<typeof ActionPackageQaSchema>;
export type ActionPackagePayload = z.infer<typeof ActionPackagePayloadSchema>;
export type ActionPackage = z.infer<typeof ActionPackageSchema>;
