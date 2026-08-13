import {writePcm16Wav} from '@pose-clip/audio';
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

function pcm16Data(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const samples = new Int16Array(size / 2);
      for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(offset + 8 + index * 2, true);
      return samples;
    }
    offset += 8 + size + size % 2;
  }
  throw new TypeError('WAV data chunk missing');
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
    const source = pcm16Data(wav);
    const start = Math.round(cue.range.startFrame * sampleRate / input.timeline.fps);
    const length = Math.min(
      cue.sampleLength,
      source.length - cue.sampleStart,
      samples.length - start,
    );
    for (let index = 0; index < length; index += 1) {
      const mixed = samples[start + index]! + source[cue.sampleStart + index]!;
      samples[start + index] = Math.max(-32768, Math.min(32767, mixed));
    }
  }
  return writePcm16Wav({sampleRate, channels: 1, interleavedSamples: samples});
}
