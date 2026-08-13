import {describe, expect, it} from 'vitest';
import {FakeTtsProvider, Qwen3TtsProvider, SapiTtsProvider, buildQwenRawCacheManifest, createTtsProvider, resolveQwenSpeaker} from '../src/tts-providers.js';

describe('M2.1 TTS providers', () => {
  it('keeps fake, Qwen3 and SAPI behind one provider contract', () => {
    expect(createTtsProvider('fake')).toBeInstanceOf(FakeTtsProvider);
    expect(createTtsProvider('qwen3')).toBeInstanceOf(Qwen3TtsProvider);
    expect(createTtsProvider('sapi')).toBeInstanceOf(SapiTtsProvider);
    expect(() => createTtsProvider('unknown')).toThrow(/Unsupported/);
  });

  it('marks only Fake TTS as non-production test audio', () => {
    expect(createTtsProvider('fake').description).toMatchObject({voice: 'test-tone-not-for-acceptance'});
    expect(createTtsProvider('qwen3').description).toMatchObject({provider: 'Qwen3-TTS local', voiceBinding: 'request.voiceId'});
  });

  it('binds the actual Qwen speaker to the Director voiceId', () => {
    expect(resolveQwenSpeaker('qwen3:Serena')).toBe('Serena');
    expect(() => resolveQwenSpeaker('huihui')).toThrow(/qwen3:<speaker>/);
  });

  it('keys raw Qwen audio by model, speaker, instruct, seed, text and language but not normalization speed', () => {
    const request = {
      id: 'tts-1', segmentId: 'segment-1', text: '测试旁白', voiceId: 'qwen3:Serena', language: 'zh-CN', speed: 1,
      inputHash: 'a'.repeat(64),
    };
    const baseline = buildQwenRawCacheManifest([request]);
    const differentSpeed = buildQwenRawCacheManifest([{...request, speed: 1.2}]);
    expect(baseline).toEqual(differentSpeed);
    expect(baseline).toMatchObject({
      model: {id: 'qwen3-tts-12hz-1.7b-customvoice', version: expect.any(String), contentHash: expect.stringMatching(/^[0-9a-f]{64}$/)},
      inference: {instruct: expect.any(String), seed: 20260813},
      requests: [{text: '测试旁白', language: 'Chinese', speaker: 'Serena'}],
    });
  });
});
