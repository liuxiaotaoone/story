import {z} from 'zod';
import {AssetRequirementSchema, DirectorActionSchema} from './director.js';
import {
  ContentHashSchema,
  IdSchema,
  ProducerRefSchema,
  SemverSchema,
} from './common.js';

export const CompileWarningSchema = z.object({
  code: IdSchema,
  message: z.string().trim().min(1),
  path: z.string().optional(),
}).strict();

export const TtsRequirementSchema = z.object({
  id: IdSchema,
  shotId: IdSchema,
  segmentId: IdSchema,
  text: z.string().trim().min(1),
  voiceId: IdSchema,
  requestedRate: z.number().finite().min(0.8).max(1.2),
  language: z.string().trim().min(1),
  inputHash: ContentHashSchema,
}).strict();

export const PreflightCompileResultSchema = z.object({
  schemaVersion: SemverSchema,
  effectiveDirectorPlanHash: ContentHashSchema,
  expandedActions: z.array(DirectorActionSchema),
  ttsRequirements: z.array(TtsRequirementSchema),
  assetRequirements: z.array(AssetRequirementSchema),
  warnings: z.array(CompileWarningSchema),
}).strict();

export const MeasuredAudioSchema = z.object({
  requirementId: IdSchema,
  assetId: IdSchema,
  sampleRate: z.number().int().positive(),
  sampleLength: z.number().int().positive(),
  durationSeconds: z.number().finite().positive(),
  measurementProducer: ProducerRefSchema,
}).strict().refine(
  ({sampleRate, sampleLength, durationSeconds}) =>
    Math.abs(sampleLength / sampleRate - durationSeconds) <= 1 / sampleRate,
  {message: 'durationSeconds must match measured sample length', path: ['durationSeconds']},
);

export const FinalCompileInputSchema = z.object({
  preflight: PreflightCompileResultSchema,
  measuredAudio: z.array(MeasuredAudioSchema),
}).strict().superRefine((input, context) => {
  const requirementIds = new Set(input.preflight.ttsRequirements.map(({id}) => id));
  const measuredIds = new Set<string>();
  for (const [index, audio] of input.measuredAudio.entries()) {
    if (!requirementIds.has(audio.requirementId)) {
      context.addIssue({code: 'custom', message: 'Measured audio has no matching TTS requirement', path: ['measuredAudio', index, 'requirementId']});
    }
    if (measuredIds.has(audio.requirementId)) {
      context.addIssue({code: 'custom', message: 'Duplicate measured audio for TTS requirement', path: ['measuredAudio', index, 'requirementId']});
    }
    measuredIds.add(audio.requirementId);
  }
  for (const requirement of input.preflight.ttsRequirements) {
    if (!measuredIds.has(requirement.id)) {
      context.addIssue({code: 'custom', message: `Missing measured audio for ${requirement.id}`, path: ['measuredAudio']});
    }
  }
});

export const CompileErrorCodeSchema = z.enum([
  'INVALID_DIRECTOR_PLAN',
  'INVALID_DIRECTOR_OVERRIDE',
  'UNSUPPORTED_CAPABILITY',
  'MISSING_ASSET',
  'MISSING_POSE_CLIP',
  'INVALID_OWNERSHIP',
  'DURATION_UNSATISFIABLE',
  'BLOCKING_UNRESOLVABLE',
  'CAMERA_UNRESOLVABLE',
  'TIMELINE_CONFLICT',
]);

export const CompileErrorSchema = z.object({
  code: CompileErrorCodeSchema,
  message: z.string().trim().min(1),
  path: z.string().optional(),
  recoverable: z.boolean(),
  suggestedFallbacks: z.array(z.string().trim().min(1)).optional(),
}).strict();

export type TtsRequirement = z.infer<typeof TtsRequirementSchema>;
export type PreflightCompileResult = z.infer<typeof PreflightCompileResultSchema>;
export type MeasuredAudio = z.infer<typeof MeasuredAudioSchema>;
export type FinalCompileInput = z.infer<typeof FinalCompileInputSchema>;
