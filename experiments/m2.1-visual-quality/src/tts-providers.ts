import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {generateFakeTts, measureWav} from '@pose-clip/audio';
import {TtsArtifactSchema, type TtsArtifact, type TtsRequest} from '@pose-clip/schemas';

const runFile = promisify(execFile);
const QWEN_MODEL_ID = 'qwen3-tts-12hz-1.7b-customvoice';
const QWEN_MODEL_VERSION = process.env.M21_QWEN_MODEL_VERSION ?? '0c0e3051f131929182e2c023b9537f8b1c68adfe';
const QWEN_MODEL_CONTENT_HASH = process.env.M21_QWEN_MODEL_HASH ?? '38b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137';
const QWEN_INSTRUCT = process.env.M21_QWEN_INSTRUCT ?? '温暖自然的儿童寓言旁白，吐字清晰，节奏舒缓但不拖沓。';
const QWEN_SEED = Number(process.env.M21_QWEN_SEED ?? 20260813);
const QWEN_ATTENTION = process.env.M21_QWEN_ATTENTION ?? 'sdpa';

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

  constructor(
    python = process.env.M21_QWEN_PYTHON ?? 'D:\\Study\\githubV2\\runtime\\python\\Scripts\\python.exe',
    modelPath = process.env.M21_QWEN_MODEL ?? 'D:\\Study\\githubV2\\models\\huggingface\\hub\\models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice\\snapshots\\0c0e3051f131929182e2c023b9537f8b1c68adfe',
  ) {
    this.python = python;
    this.modelPath = modelPath;
    this.description = {provider: 'Qwen3-TTS local', model: 'Qwen3-TTS-12Hz-1.7B-CustomVoice', modelVersion: QWEN_MODEL_VERSION, voiceBinding: 'request.voiceId', device: process.env.M21_QWEN_DEVICE ?? 'xpu:0'};
  }

  async synthesize(requests: TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]> {
    const rawRoot = resolve(context.audioRoot, 'qwen-raw');
    await mkdir(rawRoot, {recursive: true});
    const manifest = resolve(context.audioRoot, 'qwen-requests.json');
    const requestManifest = buildQwenRawCacheManifest(requests);
    let reuseExisting = false;
    if (process.env.M21_QWEN_REUSE === '1') {
      try {
        const existing = JSON.parse(await readFile(manifest, 'utf8'));
        reuseExisting = JSON.stringify(existing) === JSON.stringify(requestManifest);
        if (reuseExisting) await Promise.all(requestManifest.requests.map(item => readFile(resolve(rawRoot, item.filename))));
      } catch {
        reuseExisting = false;
      }
    }
    await writeFile(manifest, `${JSON.stringify(requestManifest, null, 2)}\n`);
    if (!reuseExisting) {
      await runFile(this.python, [
        resolve(context.root, 'scripts', 'qwen3_tts_generate.py'), '--model', this.modelPath, '--manifest', manifest,
        '--output-dir', rawRoot, '--device', process.env.M21_QWEN_DEVICE ?? 'xpu:0',
        '--instruct', QWEN_INSTRUCT, '--attention', QWEN_ATTENTION, '--seed', String(QWEN_SEED),
      ], {env: {...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'}, maxBuffer: 10 * 1024 * 1024});
    }
    return Promise.all(requests.map(async request => {
      const output = resolve(context.audioRoot, `${request.id}.wav`);
      const wavBytes = await normalizeWav(resolve(rawRoot, `${request.id}.wav`), output, request.speed, context.ffmpeg);
      return artifactFor(request, wavBytes, {name: 'qwen3-tts-local-provider', version: '1.1.0'}, {id: QWEN_MODEL_ID, version: QWEN_MODEL_VERSION});
    }));
  }
}

export function resolveQwenSpeaker(voiceId: string): string {
  if (!voiceId.startsWith('qwen3:') || voiceId.length <= 'qwen3:'.length) {
    throw new Error(`Qwen3 TTS voiceId must use qwen3:<speaker>, received ${voiceId}`);
  }
  const speaker = voiceId.slice('qwen3:'.length);
  const forcedSpeaker = process.env.M21_QWEN_SPEAKER;
  if (forcedSpeaker !== undefined && forcedSpeaker !== speaker) {
    throw new Error(`Qwen3 speaker mismatch: DirectorPlan requests ${speaker}, M21_QWEN_SPEAKER forces ${forcedSpeaker}`);
  }
  return speaker;
}

export function buildQwenRawCacheManifest(requests: TtsRequest[]) {
  if (!Number.isInteger(QWEN_SEED)) throw new Error(`M21_QWEN_SEED must be an integer, received ${QWEN_SEED}`);
  return {
    schemaVersion: '1.0.0',
    model: {id: QWEN_MODEL_ID, version: QWEN_MODEL_VERSION, contentHash: QWEN_MODEL_CONTENT_HASH},
    inference: {instruct: QWEN_INSTRUCT, seed: QWEN_SEED, attention: QWEN_ATTENTION},
    requests: requests.map(request => ({
      id: request.id,
      text: request.text,
      language: request.language.toLowerCase().startsWith('zh') ? 'Chinese' : 'Auto',
      speaker: resolveQwenSpeaker(request.voiceId),
      filename: `${request.id}.wav`,
    })),
  };
}

export function createTtsProvider(name: string): ITtsProvider {
  if (name === 'fake') return new FakeTtsProvider();
  if (name === 'sapi') return new SapiTtsProvider();
  if (name === 'qwen3') return new Qwen3TtsProvider();
  throw new Error(`Unsupported M2.1 TTS provider: ${name}`);
}
