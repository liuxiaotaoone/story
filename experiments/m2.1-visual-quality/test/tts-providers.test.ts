import {describe, expect, it} from 'vitest';
import {FakeTtsProvider, Qwen3TtsProvider, SapiTtsProvider, createTtsProvider} from '../src/tts-providers.js';

describe('M2.1 TTS providers', () => {
  it('keeps fake, Qwen3 and SAPI behind one provider contract', () => {
    expect(createTtsProvider('fake')).toBeInstanceOf(FakeTtsProvider);
    expect(createTtsProvider('qwen3')).toBeInstanceOf(Qwen3TtsProvider);
    expect(createTtsProvider('sapi')).toBeInstanceOf(SapiTtsProvider);
    expect(() => createTtsProvider('unknown')).toThrow(/Unsupported/);
  });

  it('marks only Fake TTS as non-production test audio', () => {
    expect(createTtsProvider('fake').description).toMatchObject({voice: 'test-tone-not-for-acceptance'});
    expect(createTtsProvider('qwen3').description).toMatchObject({provider: 'Qwen3-TTS local', speaker: 'Serena'});
  });
});
