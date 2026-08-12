import {z} from 'zod';
import {MeasuredAudioSchema} from './measured-audio.js';
import {PreflightCompileResultSchema} from './preflight-plan.js';

export const FinalCompileInputSchema = z.object({
  preflight: PreflightCompileResultSchema,
  measuredAudio: z.array(MeasuredAudioSchema),
}).strict().superRefine((input, context) => {
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
