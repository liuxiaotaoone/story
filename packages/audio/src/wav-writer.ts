export interface Pcm16WavInput {
  sampleRate: number;
  channels: number;
  interleavedSamples: Int16Array;
}

const RIFF_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function writePcm16Wav(input: Pcm16WavInput): Uint8Array {
  if (!Number.isInteger(input.sampleRate) || input.sampleRate <= 0) throw new RangeError('sampleRate must be a positive integer');
  if (!Number.isInteger(input.channels) || input.channels <= 0) throw new RangeError('channels must be a positive integer');
  if (input.interleavedSamples.length % input.channels !== 0) throw new RangeError('Interleaved sample count must be divisible by channels');
  const dataBytes = input.interleavedSamples.length * 2;
  const bytes = new Uint8Array(RIFF_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, input.sampleRate * input.channels * 2, true);
  view.setUint16(32, input.channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < input.interleavedSamples.length; index += 1) {
    view.setInt16(RIFF_HEADER_BYTES + index * 2, input.interleavedSamples[index]!, true);
  }
  return bytes;
}
