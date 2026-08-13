import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {TtsArtifactSchema, type TtsArtifact, type TtsRequest} from '@pose-clip/schemas';
import {measureWav} from './wav-measurer.js';

const runFile = promisify(execFile);

export interface TtsProviderResult {
  wavBytes: Uint8Array;
  artifact: TtsArtifact;
}

export interface TtsProviderContext {
  audioRoot: string;
  ffmpeg: string;
  createdAt: string;
}

export interface ITtsProvider {
  readonly kind: string;
  readonly description: Readonly<Record<string, unknown>>;
  synthesize(requests: readonly TtsRequest[], context: TtsProviderContext): Promise<TtsProviderResult[]>;
}

export function createTtsArtifact(input: {
  request: TtsRequest;
  wavBytes: Uint8Array;
  uri: string;
  producer: {name: string; version: string};
  createdAt: string;
  model?: {id: string; version: string};
}): TtsProviderResult {
  const measurement = measureWav(input.wavBytes);
  const contentHash = createHash('sha256').update(input.wavBytes).digest('hex');
  const assetId = `audio.${input.request.id}`;
  return {
    wavBytes: input.wavBytes,
    artifact: TtsArtifactSchema.parse({
      asset: {
        id: assetId, kind: 'audio', uri: input.uri, contentHash, source: 'generated', qaStatus: 'passed',
        provenance: {
          inputHash: input.request.inputHash, producer: input.producer, createdAt: input.createdAt,
          ...(input.model === undefined ? {} : {modelId: input.model.id, modelVersion: input.model.version}),
        },
      },
      measuredAudio: {
        requestId: input.request.id, sourceTtsRequestHash: input.request.inputHash, assetId,
        sampleRate: measurement.sampleRate, sampleFrameCount: measurement.sampleFrameCount,
        channels: measurement.channels, contentHash,
        measurementProducer: {name: 'pcm16-wav-measurer', version: '1.0.0'},
      },
    }),
  };
}

export async function normalizeTtsWav(input: {
  sourcePath: string;
  outputPath: string;
  speed: number;
  ffmpeg: string;
}): Promise<Uint8Array> {
  const filters = input.speed === 1 ? [] : ['-af', `atempo=${input.speed}`];
  await runFile(input.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input.sourcePath, ...filters, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', input.outputPath]);
  return readFile(input.outputPath);
}
