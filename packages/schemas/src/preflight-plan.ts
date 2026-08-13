import {z} from 'zod';
import {AssetKindSchema} from './asset.js';
import {CompileDiagnosticSchema} from './compile-diagnostics.js';
import {ContentHashSchema, IdSchema, SemverSchema} from './common.js';
import {BlockingIntentSchema, DurationPreferenceSchema} from './director-plan.js';
import {DirectionSchema} from './pose-clip.js';
import {ActionInteractionSchema} from './interaction.js';
import {ActionTargetPolicySchema} from './capability.js';
import {NarrationSegmentSchema, TtsRequestSchema} from './tts-request.js';

export const AssetRequirementSchema = z.object({
  id: IdSchema,
  kind: AssetKindSchema,
  entityType: IdSchema.optional(),
  action: IdSchema.optional(),
  direction: DirectionSchema.optional(),
  environmentIntent: z.string().trim().min(1).optional(),
  required: z.boolean(),
  requestedByActionIds: z.array(IdSchema).optional(),
}).strict().superRefine((requirement, context) => {
  const requestedBy = requirement.requestedByActionIds ?? [];
  if (new Set(requestedBy).size !== requestedBy.length) {
    context.addIssue({code: 'custom', message: 'requestedByActionIds must be unique', path: ['requestedByActionIds']});
  }
});

export const ExpandedActionSchema = z.object({
  id: IdSchema,
  sourceActionId: IdSchema,
  sceneId: IdSchema,
  shotId: IdSchema,
  actorId: IdSchema,
  action: IdSchema,
  sequence: z.number().int().nonnegative(),
  targetId: IdSchema.optional(),
  direction: DirectionSchema,
  priority: z.enum(['required', 'optional']),
  // Optional only for reading Frozen M2 Preflight artifacts. M3+ Compiler output always writes it.
  targetPolicy: ActionTargetPolicySchema.optional(),
  durationPreference: DurationPreferenceSchema.optional(),
  minDurationFrames: z.number().int().positive(),
  poseClipId: IdSchema,
  requiredPoseClipIds: z.array(IdSchema).min(1),
  completionPolicy: z.enum(['hold', 'return-default']),
  spatialMode: z.enum(['stationary', 'locomotion']),
  destinationBlocking: BlockingIntentSchema.optional(),
  interaction: ActionInteractionSchema.optional(),
  rewrite: z.object({
    fromAction: IdSchema,
    ruleReason: z.string().trim().min(1),
  }).strict().optional(),
}).strict().superRefine((action, context) => {
  if (!action.requiredPoseClipIds.includes(action.poseClipId)) context.addIssue({
    code: 'custom', message: 'poseClipId must be declared in requiredPoseClipIds', path: ['poseClipId'],
  });
  if (action.targetPolicy === 'required' && action.targetId === undefined) context.addIssue({
    code: 'custom', message: 'Required targetPolicy requires targetId', path: ['targetId'],
  });
  if (action.targetPolicy === 'none' && action.targetId !== undefined) context.addIssue({
    code: 'custom', message: 'targetPolicy=none forbids targetId', path: ['targetId'],
  });
  if (action.spatialMode === 'locomotion' && action.destinationBlocking === undefined) context.addIssue({
    code: 'custom', message: 'Locomotion action requires destinationBlocking', path: ['destinationBlocking'],
  });
  if (action.spatialMode === 'stationary' && action.destinationBlocking !== undefined) context.addIssue({
    code: 'custom', message: 'Stationary action cannot define destinationBlocking', path: ['destinationBlocking'],
  });
});

export const PreflightCompileResultSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  effectiveDirectorPlanHash: ContentHashSchema,
  capabilityCatalogVersion: SemverSchema,
  capabilityCatalogHash: ContentHashSchema,
  narrationSegments: z.array(NarrationSegmentSchema),
  ttsRequests: z.array(TtsRequestSchema),
  assetRequirements: z.array(AssetRequirementSchema),
  expandedActions: z.array(ExpandedActionSchema),
  diagnostics: z.array(CompileDiagnosticSchema),
  preflightHash: ContentHashSchema,
}).strict().superRefine((result, context) => {
  const assertUniqueIds = (values: readonly {id: string}[], path: string): void => {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seen.has(value.id)) context.addIssue({code: 'custom', message: `Duplicate ${path} id: ${value.id}`, path: [path, index, 'id']});
      seen.add(value.id);
    }
  };
  assertUniqueIds(result.narrationSegments, 'narrationSegments');
  assertUniqueIds(result.ttsRequests, 'ttsRequests');
  assertUniqueIds(result.assetRequirements, 'assetRequirements');
  assertUniqueIds(result.expandedActions, 'expandedActions');
  assertUniqueIds(result.diagnostics, 'diagnostics');
  const segmentIds = new Set(result.narrationSegments.map(segment => segment.id));
  const requestedSegmentIds = new Set<string>();
  for (const [index, request] of result.ttsRequests.entries()) {
    if (!segmentIds.has(request.segmentId)) {
      context.addIssue({code: 'custom', message: `TTS request references unknown segment: ${request.segmentId}`, path: ['ttsRequests', index, 'segmentId']});
    }
    if (requestedSegmentIds.has(request.segmentId)) {
      context.addIssue({code: 'custom', message: `Multiple TTS requests target segment: ${request.segmentId}`, path: ['ttsRequests', index, 'segmentId']});
    }
    requestedSegmentIds.add(request.segmentId);
  }
  for (const [index, segment] of result.narrationSegments.entries()) {
    if (!requestedSegmentIds.has(segment.id)) {
      context.addIssue({code: 'custom', message: `Narration segment has no TTS request: ${segment.id}`, path: ['narrationSegments', index, 'id']});
    }
  }
});

export type AssetRequirement = z.infer<typeof AssetRequirementSchema>;
export type ExpandedAction = z.infer<typeof ExpandedActionSchema>;
export type PreflightCompileResult = z.infer<typeof PreflightCompileResultSchema>;
