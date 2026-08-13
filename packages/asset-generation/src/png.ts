export interface PngMetadata {
  width: number;
  height: number;
  alphaMode: 'straight' | 'opaque';
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

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

export function inspectPng(bytes: Uint8Array): PngMetadata {
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new TypeError('Generated image is not a readable PNG');
  }
  if (chunkType(bytes, 12) !== 'IHDR' || uint32(bytes, 8) !== 13) {
    throw new TypeError('Generated PNG does not begin with a valid IHDR chunk');
  }
  const width = uint32(bytes, 16);
  const height = uint32(bytes, 20);
  if (width <= 0 || height <= 0) throw new TypeError('Generated PNG has invalid dimensions');

  const colorType = bytes[25]!;
  let hasTransparency = colorType === 4 || colorType === 6;
  let offset = 8;
  while (!hasTransparency && offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    if (type === 'tRNS') hasTransparency = true;
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return {width, height, alphaMode: hasTransparency ? 'straight' : 'opaque'};
}
