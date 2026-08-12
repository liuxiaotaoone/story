import {describe, expect, it} from 'vitest';
import {TtsArtifactSchema, canonicalHash, measuredAudioDurationSeconds} from '@pose-clip/schemas';
import {TtsIntegrityError, fakeTtsSampleFrameCount, generateFakeTts, measureWav, writePcm16Wav} from '../src/index.js';

async function request(overrides: Partial<{
  id: string;
  text: string;
  speed: number;
  language: string;
}> = {}) {
  const input = {
    id: overrides.id ?? 'tts.segment-1',
    segmentId: 'segment-1',
    text: overrides.text ?? 'A rabbit ran quickly toward the tree.',
    voiceId: 'narrator',
    speed: overrides.speed ?? 1,
    language: overrides.language ?? 'en-US',
  };
  return {...input, inputHash: await canonicalHash('tts-request-input-v1', {
    text: input.text, voiceId: input.voiceId, speed: input.speed, language: input.language,
  })};
}

describe('deterministic Fake TTS', () => {
  it('generates byte-identical PCM16 WAV and identical artifacts for the same request', async () => {
    const input = await request();
    const first = await generateFakeTts(input, 'generated/audio.wav');
    const second = await generateFakeTts(input, 'generated/audio.wav');
    expect(first.wavBytes).toEqual(second.wavBytes);
    expect(first.artifact).toEqual(second.artifact);
    expect(measureWav(first.wavBytes)).toEqual(expect.objectContaining({sampleRate: 48_000, channels: 1, bitsPerSample: 16, audioFormat: 1}));
  });

  it('changes request and WAV hashes when text changes', async () => {
    const first = await generateFakeTts(await request({text: 'A rabbit ran.'}), 'a.wav');
    const second = await generateFakeTts(await request({text: 'A farmer waited.'}), 'b.wav');
    expect(first.artifact.measuredAudio.sourceTtsRequestHash).not.toBe(second.artifact.measuredAudio.sourceTtsRequestHash);
    expect(first.artifact.asset.contentHash).not.toBe(second.artifact.asset.contentHash);
  });

  it('rejects modified request content before generating audio', async () => {
    const input = await request();
    await expect(generateFakeTts({...input, text: 'Tampered text with the old hash.'}, 'bad.wav')).rejects.toBeInstanceOf(TtsIntegrityError);
  });

  it('requires generated provenance to bind the same TTS request', async () => {
    const generated = await generateFakeTts(await request(), 'audio.wav');
    expect(TtsArtifactSchema.safeParse({
      ...generated.artifact,
      asset: {...generated.artifact.asset, source: 'manual'},
    }).success).toBe(false);
    expect(TtsArtifactSchema.safeParse({
      ...generated.artifact,
      asset: {
        ...generated.artifact.asset,
        provenance: {...generated.artifact.asset.provenance!, inputHash: '0'.repeat(64)},
      },
    }).success).toBe(false);
  });

  it('makes speed 0.8 longer than speed 1.2', async () => {
    expect(fakeTtsSampleFrameCount(await request({speed: 0.8}))).toBeGreaterThan(
      fakeTtsSampleFrameCount(await request({speed: 1.2})),
    );
  });
});

describe('independent WAV measurement', () => {
  it('derives exactly two seconds from 96000 mono PCM16 sample frames', () => {
    const wav = writePcm16Wav({sampleRate: 48_000, channels: 1, interleavedSamples: new Int16Array(96_000)});
    const measured = measureWav(wav);
    expect(measured.sampleFrameCount).toBe(96_000);
    expect(measuredAudioDurationSeconds({
      requestId: 'tts-1', sourceTtsRequestHash: '0'.repeat(64), assetId: 'audio-1',
      sampleRate: measured.sampleRate, sampleFrameCount: measured.sampleFrameCount, channels: measured.channels,
      contentHash: '0'.repeat(64), measurementProducer: {name: 'wav-test', version: '1.0.0'},
    })).toBe(2);
  });

  it('treats stereo values as sample frames rather than scalar samples', () => {
    const wav = writePcm16Wav({sampleRate: 48_000, channels: 2, interleavedSamples: new Int16Array(96_000)});
    expect(measureWav(wav).sampleFrameCount).toBe(48_000);
  });
});
