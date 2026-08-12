export interface WavMeasurement {
  sampleRate: number;
  sampleFrameCount: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  dataByteLength: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function measureWav(bytes: Uint8Array): WavMeasurement {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new TypeError('Expected a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: {audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number} | undefined;
  let dataByteLength: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.byteLength) throw new RangeError(`WAV chunk ${chunkId} exceeds file length`);
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new RangeError('WAV fmt chunk is too short');
      format = {
        audioFormat: view.getUint16(dataOffset, true),
        channels: view.getUint16(dataOffset + 2, true),
        sampleRate: view.getUint32(dataOffset + 4, true),
        blockAlign: view.getUint16(dataOffset + 12, true),
        bitsPerSample: view.getUint16(dataOffset + 14, true),
      };
    } else if (chunkId === 'data') {
      dataByteLength = chunkSize;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  if (format === undefined || dataByteLength === undefined) throw new TypeError('WAV requires fmt and data chunks');
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) throw new TypeError('Only PCM16 WAV is supported');
  if (format.channels <= 0 || format.sampleRate <= 0 || format.blockAlign !== format.channels * 2) throw new TypeError('Invalid PCM16 WAV format');
  if (dataByteLength % format.blockAlign !== 0) throw new RangeError('WAV data size is not aligned to sample frames');
  return {...format, dataByteLength, sampleFrameCount: dataByteLength / format.blockAlign};
}
