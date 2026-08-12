import {
  TtsArtifactSchema,
  TtsRequestSchema,
  sha256Bytes,
  type TtsArtifact,
  type TtsRequest,
} from '@pose-clip/schemas';
import {measureWav} from './wav-measurer.js';
import {writePcm16Wav} from './wav-writer.js';

export const FAKE_TTS_SAMPLE_RATE = 48_000;
const MIN_DURATION_SECONDS = 0.5;
const MAX_DURATION_SECONDS = 12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function fakeTtsSampleFrameCount(request: TtsRequest): number {
  const parsed = TtsRequestSchema.parse(request);
  const units = parsed.language.toLowerCase().startsWith('zh')
    ? [...parsed.text].filter(character => /[\u3400-\u9fff]/u.test(character)).length
    : parsed.text.trim().split(/\s+/u).filter(Boolean).length;
  const unitsPerSecond = parsed.language.toLowerCase().startsWith('zh') ? 4.2 : 2.8;
  const seconds = clamp((Math.max(1, units) / unitsPerSecond) / parsed.speed, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS);
  return Math.round(seconds * FAKE_TTS_SAMPLE_RATE);
}

function frequencyFromHash(inputHash: string): number {
  return 360 + Number.parseInt(inputHash.slice(0, 4), 16) % 321;
}

export async function generateFakeTts(requestInput: TtsRequest, uri: string): Promise<{wavBytes: Uint8Array; artifact: TtsArtifact}> {
  const request = TtsRequestSchema.parse(requestInput);
  const sampleFrameCount = fakeTtsSampleFrameCount(request);
  const samples = new Int16Array(sampleFrameCount);
  const frequency = frequencyFromHash(request.inputHash);
  for (let frame = 0; frame < sampleFrameCount; frame += 1) {
    const envelopeFrames = Math.min(480, Math.floor(sampleFrameCount / 8));
    const attack = envelopeFrames === 0 ? 1 : Math.min(1, frame / envelopeFrames);
    const release = envelopeFrames === 0 ? 1 : Math.min(1, (sampleFrameCount - 1 - frame) / envelopeFrames);
    const envelope = Math.min(attack, release);
    samples[frame] = Math.round(Math.sin(2 * Math.PI * frequency * frame / FAKE_TTS_SAMPLE_RATE) * 8_000 * envelope);
  }
  const wavBytes = writePcm16Wav({sampleRate: FAKE_TTS_SAMPLE_RATE, channels: 1, interleavedSamples: samples});
  const measurement = measureWav(wavBytes);
  const contentHash = await sha256Bytes(wavBytes);
  const assetId = `audio.${request.id}`;
  const artifact = TtsArtifactSchema.parse({
    asset: {
      id: assetId,
      kind: 'audio',
      uri,
      contentHash,
      source: 'generated',
      provenance: {
        inputHash: request.inputHash,
        workflowVersion: '1.0.0',
        producer: {name: 'deterministic-fake-tts', version: '1.0.0'},
        createdAt: '1970-01-01T00:00:00.000Z',
      },
      qaStatus: 'passed',
    },
    measuredAudio: {
      requestId: request.id,
      sourceTtsRequestHash: request.inputHash,
      assetId,
      sampleRate: measurement.sampleRate,
      sampleFrameCount: measurement.sampleFrameCount,
      channels: measurement.channels,
      contentHash,
      measurementProducer: {name: 'pcm16-wav-measurer', version: '1.0.0'},
    },
  });
  return {wavBytes, artifact};
}
