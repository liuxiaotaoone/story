import {z} from 'zod';
import {AssetKindSchema} from './asset.js';
import {CompileDiagnosticSchema} from './compile-diagnostics.js';
import {ContentHashSchema, IdSchema} from './common.js';
import {DirectionSchema} from './pose-clip.js';
import {NarrationSegmentSchema, TtsRequestSchema} from './tts-request.js';

export const AssetRequirementSchema = z.object({
  id: IdSchema,
  kind: AssetKindSchema,
  entityType: IdSchema.optional(),
  action: IdSchema.optional(),
  direction: DirectionSchema.optional(),
  environmentIntent: z.string().trim().min(1).optional(),
  required: z.boolean(),
}).strict();

export const ExpandedActionSchema = z.object({
  id: IdSchema,
  sourceActionId: IdSchema,
  sceneId: IdSchema,
  shotId: IdSchema,
  actorId: IdSchema,
  action: IdSchema,
  targetId: IdSchema.optional(),
  direction: DirectionSchema,
  priority: z.enum(['required', 'optional']),
  minDurationFrames: z.number().int().nonnegative(),
  requiredPoseClipIds: z.array(IdSchema),
  rewrite: z.object({
    fromAction: IdSchema,
    ruleReason: z.string().trim().min(1),
  }).strict().optional(),
}).strict();

export const PreflightCompileResultSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  effectiveDirectorPlanHash: ContentHashSchema,
  narrationSegments: z.array(NarrationSegmentSchema),
  ttsRequests: z.array(TtsRequestSchema),
  assetRequirements: z.array(AssetRequirementSchema),
  expandedActions: z.array(ExpandedActionSchema),
  diagnostics: z.array(CompileDiagnosticSchema),
}).strict().superRefine((result, context) => {
  const segmentIds = new Set(result.narrationSegments.map(segment => segment.id));
  for (const [index, request] of result.ttsRequests.entries()) {
    if (!segmentIds.has(request.segmentId)) {
      context.addIssue({code: 'custom', message: `TTS request references unknown segment: ${request.segmentId}`, path: ['ttsRequests', index, 'segmentId']});
    }
  }
});

export type AssetRequirement = z.infer<typeof AssetRequirementSchema>;
export type ExpandedAction = z.infer<typeof ExpandedActionSchema>;
export type PreflightCompileResult = z.infer<typeof PreflightCompileResultSchema>;
