import {z} from 'zod';
import {IdSchema} from './common.js';

export const CompileDiagnosticSeveritySchema = z.enum(['info', 'warning', 'error']);
export const CompileDiagnosticCodeSchema = z.enum([
  'INVALID_DIRECTOR_PLAN',
  'INVALID_DIRECTOR_OVERRIDE',
  'UNSUPPORTED_CAPABILITY',
  'ACTION_REWRITTEN',
  'MISSING_ASSET',
  'MISSING_POSE_CLIP',
  'INVALID_OWNERSHIP',
  'DURATION_UNSATISFIABLE',
  'BLOCKING_UNRESOLVABLE',
  'CAMERA_UNRESOLVABLE',
  'TIMELINE_CONFLICT',
]);

export const CompileDiagnosticSchema = z.object({
  id: IdSchema,
  severity: CompileDiagnosticSeveritySchema,
  code: CompileDiagnosticCodeSchema,
  message: z.string().trim().min(1),
  sourceId: IdSchema.optional(),
  path: z.string().startsWith('/').optional(),
  recoverable: z.boolean(),
  suggestedFallbacks: z.array(IdSchema).optional(),
}).strict();

export const CompileWarningSchema = z.object({
  code: IdSchema,
  message: z.string().trim().min(1),
  path: z.string().optional(),
}).strict();

export const CompileErrorCodeSchema = CompileDiagnosticCodeSchema;
export const CompileErrorSchema = z.object({
  code: CompileErrorCodeSchema,
  message: z.string().trim().min(1),
  path: z.string().optional(),
  recoverable: z.boolean(),
  suggestedFallbacks: z.array(z.string().trim().min(1)).optional(),
}).strict();

export type CompileDiagnostic = z.infer<typeof CompileDiagnosticSchema>;
export type CompileWarning = z.infer<typeof CompileWarningSchema>;
export type CompileError = z.infer<typeof CompileErrorSchema>;
