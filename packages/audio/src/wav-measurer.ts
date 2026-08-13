export interface WavMeasurement {
  sampleRate: number;
  sampleFrameCount: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  dataByteLength: number;
}

export function measureWav(bytes: Uint8Array): WavMeasurement {
  const decoded = decodePcm16Wav(bytes);
  return {
    sampleRate: decoded.sampleRate,
    sampleFrameCount: decoded.sampleFrameCount,
    channels: decoded.channels,
    bitsPerSample: decoded.bitsPerSample,
    audioFormat: decoded.audioFormat,
    dataByteLength: decoded.dataByteLength,
  };
}
import {decodePcm16Wav} from './wav-decoder.js';
