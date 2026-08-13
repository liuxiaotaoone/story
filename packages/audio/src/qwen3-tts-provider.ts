import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import type {TtsRequest} from '@pose-clip/schemas';
import {createTtsArtifact, normalizeTtsWav, type ITtsProvider, type TtsProviderContext, type TtsProviderResult} from './tts-provider.js';

const runFile = promisify(execFile);

export interface Qwen3TtsProviderConfig {
  python: string;
  modelPath: string;
  generatorScript: string;
  modelId: string;
  modelVersion: string;
  modelContentHash: string;
  instruct: string;
  seed: number;
  device: string;
  attention: string;
  forcedSpeaker?: string;
  reuseRawCache?: boolean;
}

export function resolveQwen3Speaker(voiceId: string, forcedSpeaker?: string): string {
  if (!voiceId.startsWith('qwen3:') || voiceId.length <= 'qwen3:'.length) throw new Error(`Qwen3 TTS voiceId must use qwen3:<speaker>, received ${voiceId}`);
  const speaker = voiceId.slice('qwen3:'.length);
  if (forcedSpeaker !== undefined && forcedSpeaker !== speaker) throw new Error(`Qwen3 speaker mismatch: request asks for ${speaker}, provider forces ${forcedSpeaker}`);
  return speaker;
}

export function buildQwen3RawCacheManifest(requests: readonly TtsRequest[], config: Qwen3TtsProviderConfig) {
  if (!Number.isInteger(config.seed)) throw new Error(`Qwen3 seed must be an integer, received ${config.seed}`);
  return {
    schemaVersion: '1.0.0',
    model: {id: config.modelId, version: config.modelVersion, contentHash: config.modelContentHash},
    inference: {instruct: config.instruct, seed: config.seed, attention: config.attention},
    requests: requests.map(request => ({
      id: request.id, text: request.text,
      language: request.language.toLowerCase().startsWith('zh') ? 'Chinese' : 'Auto',
      speaker: resolveQwen3Speaker(request.voiceId, config.forcedSpeaker), filename: `${request.id}.wav`,
    })),
  };
}

export class Qwen3TtsProvider implements ITtsProvider {
  readonly kind = 'qwen3';
  readonly description: Readonly<Record<string, unknown>>;

  constructor(private readonly config: Qwen3TtsProviderConfig) {
    this.description = {
      provider: 'Qwen3-TTS local', model: config.modelId, modelVersion: config.modelVersion,
      voiceBinding: 'request.voiceId', device: config.device,
    };
  }

  async synthesize(requests: readonly TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]> {
    const rawRoot = resolve(context.audioRoot, 'qwen-raw');
    const manifestPath = resolve(context.audioRoot, 'qwen-requests.json');
    await mkdir(rawRoot, {recursive: true});
    const manifest = buildQwen3RawCacheManifest(requests, this.config);
    let reuse = false;
    if (this.config.reuseRawCache === true) {
      try {
        reuse = JSON.stringify(JSON.parse(await readFile(manifestPath, 'utf8'))) === JSON.stringify(manifest);
        if (reuse) await Promise.all(manifest.requests.map(item => readFile(resolve(rawRoot, item.filename))));
      } catch {
        reuse = false;
      }
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (!reuse) await runFile(this.config.python, [
      this.config.generatorScript, '--model', this.config.modelPath, '--manifest', manifestPath,
      '--output-dir', rawRoot, '--device', this.config.device, '--instruct', this.config.instruct,
      '--attention', this.config.attention, '--seed', String(this.config.seed),
    ], {env: {...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'}, maxBuffer: 10 * 1024 * 1024});
    return Promise.all(requests.map(async request => {
      const outputPath = resolve(context.audioRoot, `${request.id}.wav`);
      const wavBytes = await normalizeTtsWav({sourcePath: resolve(rawRoot, `${request.id}.wav`), outputPath, speed: request.speed, ffmpeg: context.ffmpeg});
      return createTtsArtifact({
        request, wavBytes, uri: `artifacts/tts/${request.id}.wav`, createdAt: context.createdAt,
        producer: {name: 'qwen3-tts-local-provider', version: '1.0.0'},
        model: {id: this.config.modelId, version: this.config.modelVersion},
      });
    }));
  }
}
