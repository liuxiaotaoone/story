import {z} from 'zod';
import {CapabilityCatalogSchema} from './capability.js';
import {EffectiveDirectorPlanSchema} from './effective-director-plan.js';
import {MeasuredAudioSchema} from './measured-audio.js';
import {PreflightCompileResultSchema} from './preflight-plan.js';

export const FinalCompileInputSchema = z.object({
  effectiveDirectorPlan: EffectiveDirectorPlanSchema,
  preflight: PreflightCompileResultSchema,
  measuredAudio: z.array(MeasuredAudioSchema),
  capabilityCatalog: CapabilityCatalogSchema,
}).strict().superRefine((input, context) => {
  if (input.preflight.effectiveDirectorPlanHash !== input.effectiveDirectorPlan.effectivePlanHash) {
    context.addIssue({code: 'custom', message: 'Preflight was compiled from a different EffectiveDirectorPlan', path: ['preflight', 'effectiveDirectorPlanHash']});
  }
  if (input.preflight.capabilityCatalogVersion !== input.capabilityCatalog.catalogVersion) {
    context.addIssue({code: 'custom', message: 'Preflight Capability Catalog version does not match Final Compile input', path: ['preflight', 'capabilityCatalogVersion']});
  }
  if (input.preflight.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    context.addIssue({code: 'custom', message: 'Preflight errors must be resolved before Final Compile', path: ['preflight', 'diagnostics']});
  }
  const requestIds = new Set(input.preflight.ttsRequests.map(({id}) => id));
  const measuredIds = new Set<string>();
  for (const [index, audio] of input.measuredAudio.entries()) {
    if (!requestIds.has(audio.requestId)) {
      context.addIssue({code: 'custom', message: 'Measured audio has no matching TTS request', path: ['measuredAudio', index, 'requestId']});
    }
    if (measuredIds.has(audio.requestId)) {
      context.addIssue({code: 'custom', message: 'Duplicate measured audio for TTS request', path: ['measuredAudio', index, 'requestId']});
    }
    measuredIds.add(audio.requestId);
  }
  for (const request of input.preflight.ttsRequests) {
    if (!measuredIds.has(request.id)) {
      context.addIssue({code: 'custom', message: `Missing measured audio for ${request.id}`, path: ['measuredAudio']});
    }
  }
});

export type FinalCompileInput = z.infer<typeof FinalCompileInputSchema>;
