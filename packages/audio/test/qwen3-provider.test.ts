import {describe, expect, it} from 'vitest';
import type {TtsRequest} from '@pose-clip/schemas';
import {buildQwen3RawCacheManifest, resolveQwen3Speaker, type Qwen3TtsProviderConfig} from '../src/qwen3-tts-provider.js';

const config: Qwen3TtsProviderConfig = {
  python: 'python', modelPath: 'model', generatorScript: 'generate.py',
  modelId: 'qwen3', modelVersion: '1', modelContentHash: 'a'.repeat(64),
  instruct: 'warm narration', seed: 42, device: 'cpu', attention: 'sdpa',
};
const request: TtsRequest = {
  id: 'tts.segment', segmentId: 'segment', text: 'hello', voiceId: 'qwen3:Serena',
  speed: 1, language: 'zh-CN', inputHash: 'b'.repeat(64),
};

describe('production Qwen3 TTS provider contract', () => {
  it('binds speaker to request voiceId and fails closed on deployment mismatch', () => {
    expect(resolveQwen3Speaker('qwen3:Serena')).toBe('Serena');
    expect(() => resolveQwen3Speaker('sapi:Huihui')).toThrow(/qwen3:<speaker>/);
    expect(() => resolveQwen3Speaker('qwen3:Serena', 'Ryan')).toThrow(/mismatch/);
  });

  it('keys raw cache by model, voice, instruct, seed, text and language but not speed', () => {
    const baseline = buildQwen3RawCacheManifest([request], config);
    expect(buildQwen3RawCacheManifest([{...request, speed: 1.2}], config)).toEqual(baseline);
    expect(baseline).toMatchObject({
      model: {id: 'qwen3', version: '1', contentHash: 'a'.repeat(64)},
      inference: {instruct: 'warm narration', seed: 42, attention: 'sdpa'},
      requests: [{speaker: 'Serena', text: 'hello', language: 'Chinese'}],
    });
  });
});
