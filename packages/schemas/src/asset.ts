import {z} from 'zod';
import {AttachmentAnchorSchema} from './attachment.js';
import {
  ContentHashSchema,
  IdSchema,
  IsoDateTimeSchema,
  ProducerRefSchema,
  SemverSchema,
} from './common.js';

export const VisualAssetKindSchema = z.enum([
  'character-frame',
  'animal-frame',
  'prop',
  'environment-layer',
  'effect',
]);

export const NonVisualAssetKindSchema = z.enum(['audio', 'font']);
export const AssetKindSchema = z.union([VisualAssetKindSchema, NonVisualAssetKindSchema]);
export const AlphaModeSchema = z.enum(['straight', 'premultiplied', 'opaque']);
export const ContentAddressedAssetUriSchema = z.string().regex(
  /^asset:\/\/sha256\/[0-9a-f]{64}$/,
  'Expected asset://sha256/<lowercase SHA-256>',
);

export function contentAddressedAssetUri(contentHash: string): string {
  const hash = ContentHashSchema.parse(contentHash);
  return `asset://sha256/${hash}`;
}

function validateContentAddressedUri(
  asset: {uri: string; contentHash: string},
  context: z.RefinementCtx,
): void {
  if (asset.uri.startsWith('asset://sha256/') && asset.uri !== contentAddressedAssetUri(asset.contentHash)) {
    context.addIssue({
      code: 'custom',
      message: 'Content-addressed asset URI must contain the AssetRecord contentHash',
      path: ['uri'],
    });
  }
}

export const AssetProvenanceSchema = z.object({
  inputHash: ContentHashSchema,
  promptHash: ContentHashSchema.optional(),
  modelId: IdSchema.optional(),
  modelVersion: z.string().trim().min(1).optional(),
  workflowVersion: SemverSchema.optional(),
  seed: z.number().int().optional(),
  producer: ProducerRefSchema,
  createdAt: IsoDateTimeSchema,
}).strict();

const AssetRecordBaseShape = {
  id: IdSchema,
  uri: z.string().trim().min(1),
  contentHash: ContentHashSchema,
  source: z.enum(['manual', 'generated']),
  provenance: AssetProvenanceSchema.optional(),
  qaStatus: z.enum(['pending', 'passed', 'warning', 'failed']),
} as const;

export const VisualAssetRecordSchema = z.object({
  ...AssetRecordBaseShape,
  kind: VisualAssetKindSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alphaMode: AlphaModeSchema,
  attachmentAnchors: z.array(AttachmentAnchorSchema).optional(),
}).strict().superRefine((asset, context) => {
  validateContentAddressedUri(asset, context);
  if (asset.source === 'generated' && asset.provenance === undefined) {
    context.addIssue({code: 'custom', message: 'Generated assets require provenance', path: ['provenance']});
  }
  const ids = new Set<string>();
  for (const [index, anchor] of (asset.attachmentAnchors ?? []).entries()) {
    if (ids.has(anchor.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate attachment anchor: ${anchor.id}`,
        path: ['attachmentAnchors', index, 'id'],
      });
    }
    ids.add(anchor.id);
  }
});

export const NonVisualAssetRecordSchema = z.object({
  ...AssetRecordBaseShape,
  kind: NonVisualAssetKindSchema,
}).strict().superRefine((asset, context) => {
  validateContentAddressedUri(asset, context);
  if (asset.source === 'generated' && asset.provenance === undefined) {
    context.addIssue({code: 'custom', message: 'Generated assets require provenance', path: ['provenance']});
  }
});

export const AssetRecordSchema = z.union([
  VisualAssetRecordSchema,
  NonVisualAssetRecordSchema,
]);

export const AssetManifestSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  assets: z.array(AssetRecordSchema),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  for (const [index, asset] of manifest.assets.entries()) {
    if (ids.has(asset.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate asset id: ${asset.id}`,
        path: ['assets', index, 'id'],
      });
    }
    ids.add(asset.id);
  }
});

export type VisualAssetKind = z.infer<typeof VisualAssetKindSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type AssetProvenance = z.infer<typeof AssetProvenanceSchema>;
export type VisualAssetRecord = z.infer<typeof VisualAssetRecordSchema>;
export type NonVisualAssetRecord = z.infer<typeof NonVisualAssetRecordSchema>;
export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
