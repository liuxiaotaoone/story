export interface DecodedPcm16Wav {
  sampleRate: number;
  sampleFrameCount: number;
  channels: number;
  bitsPerSample: 16;
  audioFormat: 1;
  blockAlign: number;
  dataByteLength: number;
  interleavedSamples: Int16Array;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function decodePcm16Wav(bytes: Uint8Array): DecodedPcm16Wav {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new TypeError('Expected a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd > bytes.byteLength) throw new RangeError('RIFF size exceeds file length');

  let offset = 12;
  let format: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
  } | undefined;
  let data: {offset: number; byteLength: number} | undefined;
  while (offset + 8 <= riffEnd) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > riffEnd) throw new RangeError(`WAV chunk ${chunkId} exceeds RIFF length`);
    if (chunkId === 'fmt ') {
      if (format !== undefined) throw new TypeError('WAV contains duplicate fmt chunks');
      if (chunkSize < 16) throw new RangeError('WAV fmt chunk is too short');
      format = {
        audioFormat: view.getUint16(dataOffset, true),
        channels: view.getUint16(dataOffset + 2, true),
        sampleRate: view.getUint32(dataOffset + 4, true),
        byteRate: view.getUint32(dataOffset + 8, true),
        blockAlign: view.getUint16(dataOffset + 12, true),
        bitsPerSample: view.getUint16(dataOffset + 14, true),
      };
    } else if (chunkId === 'data') {
      if (data !== undefined) throw new TypeError('WAV contains duplicate data chunks');
      data = {offset: dataOffset, byteLength: chunkSize};
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  if (format === undefined || data === undefined) throw new TypeError('WAV requires fmt and data chunks');
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new TypeError('Only PCM16 WAV is supported');
  }
  if (!Number.isInteger(format.sampleRate) || format.sampleRate <= 0 || !Number.isInteger(format.channels) || format.channels <= 0) {
    throw new TypeError('Invalid PCM16 WAV sample rate or channel count');
  }
  const expectedBlockAlign = format.channels * 2;
  if (format.blockAlign !== expectedBlockAlign) throw new TypeError('Invalid PCM16 WAV blockAlign');
  if (format.byteRate !== format.sampleRate * expectedBlockAlign) throw new TypeError('Invalid PCM16 WAV byteRate');
  if (data.byteLength % expectedBlockAlign !== 0) throw new RangeError('WAV data size is not aligned to sample frames');

  const interleavedSamples = new Int16Array(data.byteLength / 2);
  for (let index = 0; index < interleavedSamples.length; index += 1) {
    interleavedSamples[index] = view.getInt16(data.offset + index * 2, true);
  }
  return {
    sampleRate: format.sampleRate,
    sampleFrameCount: data.byteLength / expectedBlockAlign,
    channels: format.channels,
    bitsPerSample: 16,
    audioFormat: 1,
    blockAlign: expectedBlockAlign,
    dataByteLength: data.byteLength,
    interleavedSamples,
  };
}
