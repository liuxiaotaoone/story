import {decodePcm16Wav, writePcm16Wav} from '@pose-clip/audio';
import type {Timeline} from '@pose-clip/schemas';

export function formatSrtTimestamp(frame: number, fps: number): string {
  const milliseconds = Math.round(frame * 1000 / fps);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function timelineToSrt(timeline: Timeline): string {
  return timeline.subtitles.map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.range.startFrame, timeline.fps)} --> ${formatSrtTimestamp(cue.range.endFrame, timeline.fps)}`,
    cue.text,
    '',
  ].join('\n')).join('\n');
}

export function assembleNarrationWav(input: {
  timeline: Timeline;
  wavByAssetId: ReadonlyMap<string, Uint8Array>;
  sampleRate?: number;
}): Uint8Array {
  const sampleRate = input.sampleRate ?? 48_000;
  const samples = new Int16Array(Math.ceil(input.timeline.durationFrames * sampleRate / input.timeline.fps));
  for (const cue of input.timeline.narration) {
    const wav = input.wavByAssetId.get(cue.assetId);
    if (wav === undefined) throw new Error(`Narration WAV missing: ${cue.assetId}`);
    const decoded = decodePcm16Wav(wav);
    if (decoded.sampleRate !== sampleRate) {
      throw new Error(`Narration ${cue.id} sample rate ${decoded.sampleRate} does not match master ${sampleRate}`);
    }
    if (decoded.channels !== 1) throw new Error(`Narration ${cue.id} must be mono PCM16`);
    const sourceEnd = cue.sampleStart + cue.sampleLength;
    if (sourceEnd > decoded.sampleFrameCount) {
      throw new RangeError(
        `Narration ${cue.id} requires source samples [${cue.sampleStart}, ${sourceEnd}), ` +
        `but WAV has ${decoded.sampleFrameCount} sample frames`,
      );
    }
    const start = Math.round(cue.range.startFrame * sampleRate / input.timeline.fps);
    const destinationEnd = start + cue.sampleLength;
    if (destinationEnd > samples.length) {
      throw new RangeError(
        `Narration ${cue.id} ends at master sample ${destinationEnd}, ` +
        `beyond timeline sample length ${samples.length}`,
      );
    }
    for (let index = 0; index < cue.sampleLength; index += 1) {
      const mixed = samples[start + index]! + decoded.interleavedSamples[cue.sampleStart + index]!;
      samples[start + index] = Math.max(-32768, Math.min(32767, mixed));
    }
  }
  return writePcm16Wav({sampleRate, channels: 1, interleavedSamples: samples});
}
