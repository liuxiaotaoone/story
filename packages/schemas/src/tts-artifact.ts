import {z} from 'zod';
import {NonVisualAssetRecordSchema} from './asset.js';
import {MeasuredAudioSchema} from './measured-audio.js';

export const TtsArtifactSchema = z.object({
  asset: NonVisualAssetRecordSchema,
  measuredAudio: MeasuredAudioSchema,
}).strict().superRefine((artifact, context) => {
  if (artifact.asset.kind !== 'audio') {
    context.addIssue({code: 'custom', message: 'TTS artifact asset must be audio', path: ['asset', 'kind']});
  }
  if (artifact.asset.id !== artifact.measuredAudio.assetId) {
    context.addIssue({code: 'custom', message: 'TTS artifact asset id does not match MeasuredAudio', path: ['measuredAudio', 'assetId']});
  }
  if (artifact.asset.contentHash !== artifact.measuredAudio.contentHash) {
    context.addIssue({code: 'custom', message: 'TTS artifact content hashes do not match', path: ['measuredAudio', 'contentHash']});
  }
});

export type TtsArtifact = z.infer<typeof TtsArtifactSchema>;
