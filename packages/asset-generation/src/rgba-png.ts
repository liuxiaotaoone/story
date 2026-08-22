import {deflateSync, inflateSync} from 'node:zlib';
import {inspectPng} from './png.js';

export interface DecodedRgbaPng {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC32_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  return crc >>> 0;
});

function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilter(
  inflated: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const rowBytes = width * bytesPerPixel;
  const output = new Uint8Array(rowBytes * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset++]!;
    const rowOffset = row * rowBytes;
    const previousRowOffset = rowOffset - rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = inflated[sourceOffset++]!;
      const left = column < bytesPerPixel ? 0 : output[rowOffset + column - bytesPerPixel]!;
      const above = row === 0 ? 0 : output[previousRowOffset + column]!;
      const upperLeft = row === 0 || column < bytesPerPixel
        ? 0
        : output[previousRowOffset + column - bytesPerPixel]!;
      let value: number;
      switch (filter) {
        case 0: value = encoded; break;
        case 1: value = encoded + left; break;
        case 2: value = encoded + above; break;
        case 3: value = encoded + Math.floor((left + above) / 2); break;
        case 4: value = encoded + paeth(left, above, upperLeft); break;
        default: throw new TypeError(`PNG has unsupported scanline filter ${filter}`);
      }
      output[rowOffset + column] = value & 0xff;
    }
  }
  return output;
}

/** Decodes the 8-bit, non-interlaced RGB/RGBA subset emitted by ComfyUI SaveImage. */
export function decodePngToRgba8(bytes: Uint8Array): DecodedRgbaPng {
  const metadata = inspectPng(bytes);
  const ihdrDataOffset = PNG_SIGNATURE.length + 8;
  const bitDepth = bytes[ihdrDataOffset + 8]!;
  const colorType = bytes[ihdrDataOffset + 9]!;
  const interlace = bytes[ihdrDataOffset + 12]!;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new TypeError('Matting requires an 8-bit non-interlaced RGB or RGBA PNG');
  }
  if (colorType === 2 && metadata.alphaMode !== 'opaque') {
    throw new TypeError('Matting does not support RGB PNG with tRNS transparency');
  }
  const idat: Uint8Array[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const type = String.fromCharCode(
      bytes[typeOffset]!, bytes[typeOffset + 1]!, bytes[typeOffset + 2]!, bytes[typeOffset + 3]!,
    );
    if (type === 'IDAT') idat.push(bytes.slice(dataOffset, dataOffset + length));
    offset = dataOffset + length + 4;
    if (type === 'IEND') break;
  }
  const compressedLength = idat.reduce((total, chunk) => total + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }
  const inflated = new Uint8Array(inflateSync(compressed, {info: true}).buffer);
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const source = unfilter(inflated, metadata.width, metadata.height, bytesPerPixel);
  if (colorType === 6) return {width: metadata.width, height: metadata.height, pixels: source};
  const pixels = new Uint8Array(metadata.width * metadata.height * 4);
  for (let sourceOffset = 0, targetOffset = 0; sourceOffset < source.length; sourceOffset += 3, targetOffset += 4) {
    pixels[targetOffset] = source[sourceOffset]!;
    pixels[targetOffset + 1] = source[sourceOffset + 1]!;
    pixels[targetOffset + 2] = source[sourceOffset + 2]!;
    pixels[targetOffset + 3] = 255;
  }
  return {width: metadata.width, height: metadata.height, pixels};
}

export function decodeRgbaPng8(bytes: Uint8Array): DecodedRgbaPng {
  const decoded = decodePngToRgba8(bytes);
  const ihdrDataOffset = PNG_SIGNATURE.length + 8;
  if (bytes[ihdrDataOffset + 9] !== 6) throw new TypeError('Matting output must be an RGBA PNG');
  return decoded;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(data.length + 12);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, data.length + 8, crc32(chunk.slice(4, data.length + 8)));
  return chunk;
}

export function encodeRgbaPng(input: DecodedRgbaPng): Uint8Array {
  if (!Number.isInteger(input.width) || input.width <= 0 || !Number.isInteger(input.height) || input.height <= 0) {
    throw new TypeError('RGBA PNG dimensions must be positive integers');
  }
  if (input.pixels.length !== input.width * input.height * 4) {
    throw new TypeError('RGBA PNG pixel length does not match dimensions');
  }
  const scanlines = new Uint8Array(input.height * (input.width * 4 + 1));
  const rowBytes = input.width * 4;
  for (let row = 0; row < input.height; row += 1) {
    const targetOffset = row * (rowBytes + 1);
    scanlines[targetOffset] = 0;
    scanlines.set(input.pixels.slice(row * rowBytes, (row + 1) * rowBytes), targetOffset + 1);
  }
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, input.width);
  writeUint32(ihdr, 4, input.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', new Uint8Array())];
  const length = PNG_SIGNATURE.length + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  output.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  inspectPng(output);
  return output;
}

export function rgbaAlphaRange(pixels: Uint8Array): {min: number; max: number} {
  if (pixels.length === 0 || pixels.length % 4 !== 0) throw new TypeError('Expected non-empty RGBA pixels');
  let min = 255;
  let max = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset]!;
    min = Math.min(min, alpha);
    max = Math.max(max, alpha);
  }
  return {min, max};
}
