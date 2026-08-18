import {inflateSync} from 'node:zlib';

export interface PngMetadata {
  width: number;
  height: number;
  alphaMode: 'straight' | 'opaque';
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const CRC32_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  return crc >>> 0;
});

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!
  );
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
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

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new TypeError(`Generated PNG has unsupported color type ${colorType}`);
  }
}

function validBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0: return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
    case 4:
    case 6: return bitDepth === 8 || bitDepth === 16;
    case 3: return [1, 2, 4, 8].includes(bitDepth);
    default: return false;
  }
}

function passDimensions(width: number, height: number, startX: number, startY: number, stepX: number, stepY: number) {
  return {
    width: width <= startX ? 0 : Math.ceil((width - startX) / stepX),
    height: height <= startY ? 0 : Math.ceil((height - startY) / stepY),
  };
}

function expectedInflatedLength(
  width: number,
  height: number,
  channels: number,
  bitDepth: number,
  interlaceMethod: number,
): number {
  const bitsPerPixel = channels * bitDepth;
  const rowLength = (passWidth: number) => Math.ceil(passWidth * bitsPerPixel / 8) + 1;
  if (interlaceMethod === 0) return height * rowLength(width);
  const passes = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8],
    [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ] as const;
  return passes.reduce((total, [startX, startY, stepX, stepY]) => {
    const dimensions = passDimensions(width, height, startX, startY, stepX, stepY);
    if (dimensions.width === 0 || dimensions.height === 0) return total;
    return total + dimensions.height * rowLength(dimensions.width);
  }, 0);
}

function assertScanlineFilters(
  inflated: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bitDepth: number,
  interlaceMethod: number,
): void {
  const bitsPerPixel = channels * bitDepth;
  let offset = 0;
  const consumePass = (passWidth: number, passHeight: number) => {
    if (passWidth === 0 || passHeight === 0) return;
    const rowBytes = Math.ceil(passWidth * bitsPerPixel / 8);
    for (let row = 0; row < passHeight; row += 1) {
      if (offset + rowBytes + 1 > inflated.length) throw new TypeError('Generated PNG has incomplete scanline data');
      if (inflated[offset]! > 4) throw new TypeError('Generated PNG has an invalid scanline filter');
      offset += rowBytes + 1;
    }
  };
  if (interlaceMethod === 0) {
    consumePass(width, height);
  } else {
    const passes = [
      [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8],
      [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
    ] as const;
    for (const [startX, startY, stepX, stepY] of passes) {
      const dimensions = passDimensions(width, height, startX, startY, stepX, stepY);
      consumePass(dimensions.width, dimensions.height);
    }
  }
  if (offset !== inflated.length) throw new TypeError('Generated PNG has trailing image data');
}

export function inspectPng(bytes: Uint8Array): PngMetadata {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new TypeError('Generated image is not a readable PNG');
  }
  let offset: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlaceMethod = 0;
  let seenIhdr = false;
  let seenIdat = false;
  let closedIdatSequence = false;
  let seenIend = false;
  let paletteEntries = 0;
  let hasTransparency = false;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new TypeError('Generated PNG has a truncated chunk');
    const length = uint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > bytes.length) throw new TypeError('Generated PNG has a truncated chunk payload');
    const type = chunkType(bytes, typeOffset);
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new TypeError('Generated PNG has an invalid chunk type');
    const crcInput = bytes.slice(typeOffset, crcOffset);
    if (crc32(crcInput) !== uint32(bytes, crcOffset)) {
      throw new TypeError(`Generated PNG has an invalid ${type} CRC`);
    }
    if (!seenIhdr && type !== 'IHDR') throw new TypeError('Generated PNG must begin with IHDR');
    if (type === 'IHDR') {
      if (seenIhdr || length !== 13) throw new TypeError('Generated PNG has an invalid IHDR chunk');
      width = uint32(bytes, dataOffset);
      height = uint32(bytes, dataOffset + 4);
      bitDepth = bytes[dataOffset + 8]!;
      colorType = bytes[dataOffset + 9]!;
      if (width <= 0 || height <= 0) throw new TypeError('Generated PNG has invalid dimensions');
      if (!validBitDepth(colorType, bitDepth)) throw new TypeError('Generated PNG has an invalid bit depth');
      if (bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0) {
        throw new TypeError('Generated PNG has unsupported compression or filter method');
      }
      interlaceMethod = bytes[dataOffset + 12]!;
      if (interlaceMethod !== 0 && interlaceMethod !== 1) throw new TypeError('Generated PNG has an invalid interlace method');
      seenIhdr = true;
    } else if (type === 'PLTE') {
      if (
        seenIdat
        || paletteEntries !== 0
        || colorType === 0
        || colorType === 4
        || length === 0
        || length > 768
        || length % 3 !== 0
        || (colorType === 3 && length / 3 > 2 ** bitDepth)
      ) {
        throw new TypeError('Generated PNG has an invalid PLTE chunk');
      }
      paletteEntries = length / 3;
    } else if (type === 'tRNS') {
      if (seenIdat) throw new TypeError('Generated PNG has transparency data after IDAT');
      if (
        (colorType === 0 && length !== 2)
        || (colorType === 2 && length !== 6)
        || (colorType === 3 && (paletteEntries === 0 || length > paletteEntries))
        || colorType === 4
        || colorType === 6
      ) throw new TypeError('Generated PNG has an invalid tRNS chunk');
      hasTransparency = true;
    } else if (type === 'IDAT') {
      if (seenIend || closedIdatSequence) throw new TypeError('Generated PNG has a non-contiguous IDAT sequence');
      if (colorType === 3 && paletteEntries === 0) throw new TypeError('Generated indexed PNG is missing PLTE');
      seenIdat = true;
      idatChunks.push(bytes.slice(dataOffset, crcOffset));
    } else if (type === 'IEND') {
      if (length !== 0 || !seenIdat) throw new TypeError('Generated PNG has an invalid IEND sequence');
      seenIend = true;
      offset = nextOffset;
      break;
    } else {
      if (seenIdat) closedIdatSequence = true;
      if (type[0] === type[0]?.toUpperCase()) throw new TypeError(`Generated PNG has unknown critical chunk ${type}`);
    }
    offset = nextOffset;
  }
  if (!seenIhdr || !seenIdat || !seenIend || offset !== bytes.length) {
    throw new TypeError('Generated PNG is missing a complete IHDR/IDAT/IEND structure');
  }

  let inflated: Uint8Array;
  try {
    const compressed = new Uint8Array(idatChunks.reduce((total, chunk) => total + chunk.length, 0));
    let compressedOffset = 0;
    for (const chunk of idatChunks) {
      compressed.set(chunk, compressedOffset);
      compressedOffset += chunk.length;
    }
    inflated = new Uint8Array(inflateSync(compressed));
  } catch (error) {
    throw new TypeError('Generated PNG image data cannot be decoded', {cause: error});
  }
  const channels = channelsForColorType(colorType);
  const expectedLength = expectedInflatedLength(width, height, channels, bitDepth, interlaceMethod);
  if (inflated.length !== expectedLength) throw new TypeError('Generated PNG has incomplete image data');
  assertScanlineFilters(inflated, width, height, channels, bitDepth, interlaceMethod);
  return {width, height, alphaMode: hasTransparency || colorType === 4 || colorType === 6 ? 'straight' : 'opaque'};
}

export function addPngTextChunk(bytes: Uint8Array, keyword: string, value: string): Uint8Array {
  inspectPng(bytes);
  if (!/^[\x20-\x7e]{1,79}$/u.test(keyword)) throw new TypeError('PNG text keyword must be printable ASCII');
  const data = new TextEncoder().encode(`${keyword}\0${value}`);
  const type = new TextEncoder().encode('tEXt');
  const chunk = new Uint8Array(data.length + 12);
  writeUint32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeUint32(chunk, data.length + 8, crc32(chunk.slice(4, data.length + 8)));
  const iendOffset = bytes.length - 12;
  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.slice(0, iendOffset));
  output.set(chunk, iendOffset);
  output.set(bytes.slice(iendOffset), iendOffset + chunk.length);
  return output;
}
