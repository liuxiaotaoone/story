import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {generateFakeTts, measureWav} from '@pose-clip/audio';
import {TtsArtifactSchema, type TtsArtifact, type TtsRequest} from '@pose-clip/schemas';

const runFile = promisify(execFile);

export interface TtsProviderResult {
  wavBytes: Uint8Array;
  artifact: TtsArtifact;
}

export interface TtsProviderContext {
  audioRoot: string;
  ffmpeg: string;
  root: string;
}

export interface ITtsProvider {
  readonly kind: 'fake' | 'qwen3' | 'sapi';
  readonly description: Record<string, unknown>;
  synthesize(requests: TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactFor(request: TtsRequest, wavBytes: Uint8Array, producer: {name: string; version: string}, model?: {id: string; version: string}): TtsProviderResult {
  const measurement = measureWav(wavBytes);
  const contentHash = sha256(wavBytes);
  const assetId = `audio.${request.id}`;
  const artifact = TtsArtifactSchema.parse({
    asset: {
      id: assetId, kind: 'audio', uri: `artifacts/tts/${request.id}.wav`, contentHash, source: 'generated', qaStatus: 'passed',
      provenance: {
        inputHash: request.inputHash, producer, createdAt: '2026-08-13T00:00:00.000Z',
        ...(model === undefined ? {} : {modelId: model.id, modelVersion: model.version}),
      },
    },
    measuredAudio: {
      requestId: request.id, sourceTtsRequestHash: request.inputHash, assetId,
      sampleRate: measurement.sampleRate, sampleFrameCount: measurement.sampleFrameCount,
      channels: measurement.channels, contentHash,
      measurementProducer: {name: 'pcm16-wav-measurer', version: '1.0.0'},
    },
  });
  return {wavBytes, artifact};
}

async function normalizeWav(input: string, output: string, speed: number, ffmpeg: string): Promise<Uint8Array> {
  const filters = speed === 1 ? [] : ['-af', `atempo=${speed}`];
  await runFile(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...filters, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
  return readFile(output);
}

export class FakeTtsProvider implements ITtsProvider {
  readonly kind = 'fake' as const;
  readonly description = {provider: 'deterministic-fake-tts', voice: 'test-tone-not-for-acceptance'};

  async synthesize(requests: TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]> {
    return Promise.all(requests.map(async request => {
      const result = await generateFakeTts(request, `artifacts/tts/${request.id}.wav`);
      await writeFile(resolve(context.audioRoot, `${request.id}.wav`), result.wavBytes);
      return result;
    }));
  }
}

export class SapiTtsProvider implements ITtsProvider {
  readonly kind = 'sapi' as const;
  readonly description = {provider: 'Windows SAPI', voice: 'Microsoft Huihui Desktop', fallback: true};

  async synthesize(requests: TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]> {
    return Promise.all(requests.map(async request => {
      const raw = resolve(context.audioRoot, `${request.id}.sapi.raw.wav`);
      const output = resolve(context.audioRoot, `${request.id}.wav`);
      await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(context.root, 'scripts', 'generate-sapi-tts.ps1'), '-Text', request.text, '-OutputPath', raw]);
      const wavBytes = await normalizeWav(raw, output, request.speed, context.ffmpeg);
      return artifactFor(request, wavBytes, {name: 'windows-sapi-huihui', version: '1.0.0'});
    }));
  }
}

export class Qwen3TtsProvider implements ITtsProvider {
  readonly kind = 'qwen3' as const;
  readonly description: Record<string, unknown>;
  private readonly python: string;
  private readonly modelPath: string;
  private readonly speaker: string;

  constructor(
    python = process.env.M21_QWEN_PYTHON ?? 'D:\\Study\\githubV2\\runtime\\python\\Scripts\\python.exe',
    modelPath = process.env.M21_QWEN_MODEL ?? 'D:\\Study\\githubV2\\models\\huggingface\\hub\\models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice\\snapshots\\0c0e3051f131929182e2c023b9537f8b1c68adfe',
    speaker = process.env.M21_QWEN_SPEAKER ?? 'Serena',
  ) {
    this.python = python;
    this.modelPath = modelPath;
    this.speaker = speaker;
    this.description = {provider: 'Qwen3-TTS local', model: 'Qwen3-TTS-12Hz-1.7B-CustomVoice', speaker: this.speaker, device: process.env.M21_QWEN_DEVICE ?? 'xpu:0'};
  }

  async synthesize(requests: TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]> {
    const rawRoot = resolve(context.audioRoot, 'qwen-raw');
    await mkdir(rawRoot, {recursive: true});
    const manifest = resolve(context.audioRoot, 'qwen-requests.json');
    const requestManifest = requests.map(request => ({id: request.id, text: request.text, language: request.language.toLowerCase().startsWith('zh') ? 'Chinese' : 'Auto', filename: `${request.id}.wav`}));
    let reuseExisting = false;
    if (process.env.M21_QWEN_REUSE === '1') {
      try {
        const existing = JSON.parse(await readFile(manifest, 'utf8'));
        reuseExisting = JSON.stringify(existing) === JSON.stringify(requestManifest);
        if (reuseExisting) await Promise.all(requestManifest.map(item => readFile(resolve(rawRoot, item.filename))));
      } catch {
        reuseExisting = false;
      }
    }
    await writeFile(manifest, `${JSON.stringify(requestManifest, null, 2)}\n`);
    if (!reuseExisting) {
      await runFile(this.python, [
        resolve(context.root, 'scripts', 'qwen3_tts_generate.py'), '--model', this.modelPath, '--manifest', manifest,
        '--output-dir', rawRoot, '--device', process.env.M21_QWEN_DEVICE ?? 'xpu:0', '--speaker', this.speaker,
        '--attention', process.env.M21_QWEN_ATTENTION ?? 'sdpa',
      ], {env: {...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'}, maxBuffer: 10 * 1024 * 1024});
    }
    return Promise.all(requests.map(async request => {
      const output = resolve(context.audioRoot, `${request.id}.wav`);
      const wavBytes = await normalizeWav(resolve(rawRoot, `${request.id}.wav`), output, request.speed, context.ffmpeg);
      return artifactFor(request, wavBytes, {name: 'qwen3-tts-local-provider', version: '1.0.0'}, {id: 'qwen3-tts-12hz-1.7b-customvoice', version: '0c0e3051'});
    }));
  }
}

export function createTtsProvider(name: string): ITtsProvider {
  if (name === 'fake') return new FakeTtsProvider();
  if (name === 'sapi') return new SapiTtsProvider();
  if (name === 'qwen3') return new Qwen3TtsProvider();
  throw new Error(`Unsupported M2.1 TTS provider: ${name}`);
}
