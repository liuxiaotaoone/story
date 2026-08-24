import type {
  PoseAnchors,
  PoseFrameProcessStage,
  PoseFrameProcessorSpec,
} from '@pose-clip/schemas';
import {PoseAnchorsSchema} from '@pose-clip/schemas';
import {addPngTextChunk} from './png.js';
import {decodePngToRgba8, encodeRgbaPng} from './rgba-png.js';

export interface PoseFrameProcessorInput {
  readonly bytes: Uint8Array;
  readonly inputContentHash: string;
  readonly spec: PoseFrameProcessorSpec;
}

export interface PoseFrameProcessorOutput {
  readonly bytes: Uint8Array;
  readonly anchors?: PoseAnchors;
}

export interface PoseFrameProcessor {
  readonly id: string;
  readonly version: string;
  readonly stage: PoseFrameProcessStage;
  process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput>;
}

export class PoseFrameProcessorTransientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PoseFrameProcessorTransientError';
  }
}

export class PoseFrameProcessorContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PoseFrameProcessorContractError';
  }
}

export interface ChromaKeyMattingConfig {
  readonly keyColor: readonly [number, number, number];
  readonly transparentThreshold: number;
  readonly opaqueThreshold: number;
  readonly spillSuppression: number;
}

export interface BorderConnectedCleanupConfig {
  readonly alphaThreshold: number;
  readonly borderInset: number;
  readonly connectivity: 4 | 8;
  readonly greenMinimum: number;
  readonly greenDominance: number;
  readonly edgeSpillRadius: number;
  readonly retainNearSubjectPx: number;
  readonly minimumComponentPixels: number;
}

export interface BorderConnectedChromaKeyMattingConfig extends ChromaKeyMattingConfig {
  readonly borderCleanup: BorderConnectedCleanupConfig;
}

function parseByte(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 255) {
    throw new PoseFrameProcessorContractError(`${label} must be an integer from 0 to 255`);
  }
  return value;
}

function parseUnit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PoseFrameProcessorContractError(`${label} must be between 0 and 1`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new PoseFrameProcessorContractError(`${label} must be a non-negative integer`);
  }
  return value;
}

function parsePositiveInteger(value: unknown, label: string): number {
  const parsed = parseNonNegativeInteger(value, label);
  if (parsed === 0) throw new PoseFrameProcessorContractError(`${label} must be at least 1`);
  return parsed;
}

function parseChromaKeyConfig(value: unknown): ChromaKeyMattingConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PoseFrameProcessorContractError('Chroma Key Matting requires an object config');
  }
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).sort();
  const expectedKeys = ['keyColor', 'opaqueThreshold', 'spillSuppression', 'transparentThreshold'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new PoseFrameProcessorContractError('Chroma Key Matting config contains missing or unknown fields');
  }
  if (!Array.isArray(config.keyColor) || config.keyColor.length !== 3) {
    throw new PoseFrameProcessorContractError('Chroma Key Matting keyColor must contain RGB bytes');
  }
  const transparentThreshold = parseUnit(config.transparentThreshold, 'transparentThreshold');
  const opaqueThreshold = parseUnit(config.opaqueThreshold, 'opaqueThreshold');
  if (opaqueThreshold <= transparentThreshold) throw new PoseFrameProcessorContractError(
    'opaqueThreshold must be greater than transparentThreshold',
  );
  return {
    keyColor: [
      parseByte(config.keyColor[0], 'keyColor[0]'),
      parseByte(config.keyColor[1], 'keyColor[1]'),
      parseByte(config.keyColor[2], 'keyColor[2]'),
    ],
    transparentThreshold,
    opaqueThreshold,
    spillSuppression: parseUnit(config.spillSuppression, 'spillSuppression'),
  };
}

function parseBorderConnectedChromaKeyConfig(value: unknown): BorderConnectedChromaKeyMattingConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PoseFrameProcessorContractError('Border-connected Chroma Key Matting requires an object config');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expectedKeys = [
    'borderCleanup', 'keyColor', 'opaqueThreshold', 'spillSuppression', 'transparentThreshold',
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new PoseFrameProcessorContractError(
      'Border-connected Chroma Key Matting config contains missing or unknown fields',
    );
  }
  const base = parseChromaKeyConfig({
    keyColor: input.keyColor,
    transparentThreshold: input.transparentThreshold,
    opaqueThreshold: input.opaqueThreshold,
    spillSuppression: input.spillSuppression,
  });
  if (typeof input.borderCleanup !== 'object' || input.borderCleanup === null || Array.isArray(input.borderCleanup)) {
    throw new PoseFrameProcessorContractError('borderCleanup must be an object');
  }
  const cleanup = input.borderCleanup as Record<string, unknown>;
  const cleanupKeys = Object.keys(cleanup).sort();
  const expectedCleanupKeys = [
    'alphaThreshold', 'borderInset', 'connectivity', 'edgeSpillRadius', 'greenDominance', 'greenMinimum',
    'minimumComponentPixels', 'retainNearSubjectPx',
  ];
  if (
    cleanupKeys.length !== expectedCleanupKeys.length
    || cleanupKeys.some((key, index) => key !== expectedCleanupKeys[index])
  ) throw new PoseFrameProcessorContractError('borderCleanup contains missing or unknown fields');
  const alphaThreshold = parseByte(cleanup.alphaThreshold, 'borderCleanup.alphaThreshold');
  if (alphaThreshold === 0) throw new PoseFrameProcessorContractError(
    'borderCleanup.alphaThreshold must be at least 1',
  );
  const connectivity = cleanup.connectivity;
  if (connectivity !== 4 && connectivity !== 8) throw new PoseFrameProcessorContractError(
    'borderCleanup.connectivity must be 4 or 8',
  );
  return {
    ...base,
    borderCleanup: {
      alphaThreshold,
      borderInset: parseNonNegativeInteger(cleanup.borderInset, 'borderCleanup.borderInset'),
      connectivity,
      edgeSpillRadius: parseNonNegativeInteger(cleanup.edgeSpillRadius, 'borderCleanup.edgeSpillRadius'),
      greenMinimum: parseByte(cleanup.greenMinimum, 'borderCleanup.greenMinimum'),
      greenDominance: parseByte(cleanup.greenDominance, 'borderCleanup.greenDominance'),
      retainNearSubjectPx: parseNonNegativeInteger(
        cleanup.retainNearSubjectPx,
        'borderCleanup.retainNearSubjectPx',
      ),
      minimumComponentPixels: parsePositiveInteger(
        cleanup.minimumComponentPixels,
        'borderCleanup.minimumComponentPixels',
      ),
    },
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function applyChromaKey(
  pixels: Uint8Array,
  config: ChromaKeyMattingConfig,
): void {
  const [keyRed, keyGreen, keyBlue] = config.keyColor;
  const maximumDistance = Math.sqrt(3 * 255 * 255);
  const range = config.opaqueThreshold - config.transparentThreshold;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const originalAlpha = pixels[offset + 3]! / 255;
    const distance = Math.sqrt(
      (red - keyRed) ** 2 + (green - keyGreen) ** 2 + (blue - keyBlue) ** 2,
    ) / maximumDistance;
    const chromaAlpha = Math.max(0, Math.min(1, (distance - config.transparentThreshold) / range));
    const alpha = originalAlpha * chromaAlpha;
    const dominantGreen = Math.max(0, green - Math.max(red, blue));
    pixels[offset + 1] = clampByte(
      green - dominantGreen * config.spillSuppression * (1 - chromaAlpha),
    );
    pixels[offset + 3] = clampByte(alpha * 255);
  }
}

const NEIGHBOR_OFFSETS_4 = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
const NEIGHBOR_OFFSETS_8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

interface PixelComponent {
  readonly label: number;
  readonly size: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function visitNeighbors(
  index: number,
  width: number,
  height: number,
  connectivity: 4 | 8,
  visit: (neighbor: number) => void,
): void {
  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = connectivity === 4 ? NEIGHBOR_OFFSETS_4 : NEIGHBOR_OFFSETS_8;
  for (const [deltaX, deltaY] of offsets) {
    const neighborX = x + deltaX;
    const neighborY = y + deltaY;
    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
    visit(neighborY * width + neighborX);
  }
}

function clearBorderConnectedGreen(
  pixels: Uint8Array,
  sourcePixels: Uint8Array,
  width: number,
  height: number,
  config: BorderConnectedCleanupConfig,
): void {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const isGreenCandidate = (index: number): boolean => {
    const offset = index * 4;
    const red = sourcePixels[offset]!;
    const green = sourcePixels[offset + 1]!;
    const blue = sourcePixels[offset + 2]!;
    return green >= config.greenMinimum && green - Math.max(red, blue) >= config.greenDominance;
  };
  const enqueue = (index: number): void => {
    if (visited[index] !== 0 || !isGreenCandidate(index)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  const inset = Math.min(config.borderInset, Math.ceil(Math.min(width, height) / 2));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= inset && x < width - inset && y >= inset && y < height - inset) continue;
      const index = y * width + x;
      pixels[index * 4 + 3] = 0;
      enqueue(index);
    }
  }
  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    pixels[index * 4 + 3] = 0;
    visitNeighbors(index, width, height, config.connectivity, enqueue);
  }
}

function componentGap(left: PixelComponent, right: PixelComponent): number {
  const horizontal = Math.max(0, left.minX - right.maxX - 1, right.minX - left.maxX - 1);
  const vertical = Math.max(0, left.minY - right.maxY - 1, right.minY - left.maxY - 1);
  return Math.max(horizontal, vertical);
}

function retainPrimaryForeground(
  pixels: Uint8Array,
  width: number,
  height: number,
  config: BorderConnectedCleanupConfig,
): void {
  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: PixelComponent[] = [];
  let nextLabel = 1;
  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (labels[seed] !== 0 || pixels[seed * 4 + 3]! < config.alphaThreshold) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    labels[seed] = nextLabel;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head]!;
      head += 1;
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visitNeighbors(index, width, height, config.connectivity, (neighbor) => {
        if (labels[neighbor] !== 0 || pixels[neighbor * 4 + 3]! < config.alphaThreshold) return;
        labels[neighbor] = nextLabel;
        queue[tail] = neighbor;
        tail += 1;
      });
    }
    components.push({label: nextLabel, size, minX, minY, maxX, maxY});
    nextLabel += 1;
  }
  const primary = components.reduce<PixelComponent | undefined>((largest, component) => (
    largest === undefined || component.size > largest.size ? component : largest
  ), undefined);
  if (primary === undefined) throw new PoseFrameProcessorContractError(
    'Border-connected Chroma Key Matting removed all foreground',
  );
  const retained = new Set([primary.label]);
  const retainedComponents = [primary];
  for (let cursor = 0; cursor < retainedComponents.length; cursor += 1) {
    const linkedFrom = retainedComponents[cursor]!;
    for (const component of components) {
      if (retained.has(component.label) || component.size < config.minimumComponentPixels) continue;
      if (componentGap(component, linkedFrom) > config.retainNearSubjectPx) continue;
      retained.add(component.label);
      retainedComponents.push(component);
    }
  }
  for (let index = 0; index < pixelCount; index += 1) {
    const label = labels[index]!;
    if (label !== 0 && !retained.has(label)) pixels[index * 4 + 3] = 0;
  }
}

function suppressSurvivingEdgeSpill(
  pixels: Uint8Array,
  width: number,
  height: number,
  config: BorderConnectedChromaKeyMattingConfig,
): void {
  const radius = config.borderCleanup.edgeSpillRadius;
  if (radius === 0 || config.spillSuppression === 0) return;
  const source = pixels.slice();
  const threshold = config.borderCleanup.alphaThreshold;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (source[offset + 3]! < threshold) continue;
      let touchesTransparency = false;
      for (let deltaY = -radius; deltaY <= radius && !touchesTransparency; deltaY += 1) {
        for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
          const neighborX = x + deltaX;
          const neighborY = y + deltaY;
          if (
            neighborX < 0
            || neighborX >= width
            || neighborY < 0
            || neighborY >= height
            || source[(neighborY * width + neighborX) * 4 + 3]! < threshold
          ) {
            touchesTransparency = true;
            break;
          }
        }
      }
      if (!touchesTransparency) continue;
      const red = source[offset]!;
      const green = source[offset + 1]!;
      const blue = source[offset + 2]!;
      const dominantGreen = Math.max(0, green - Math.max(red, blue));
      pixels[offset + 1] = clampByte(green - dominantGreen * config.spillSuppression);
    }
  }
}

/** A deterministic, pixel-producing chroma-key matting implementation for green-screen Raw frames. */
export class ChromaKeyPoseFrameMattingProcessor implements PoseFrameProcessor {
  readonly id = 'chroma-key-matting';
  readonly version = '1.0.0';
  readonly stage = 'matted' as const;

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    if (
      input.spec.stage !== this.stage
      || input.spec.processor.name !== this.id
      || input.spec.processor.version !== this.version
    ) throw new PoseFrameProcessorContractError('Chroma Key Matting processor binding is invalid');
    if (input.spec.model !== undefined) throw new PoseFrameProcessorContractError(
      'Chroma Key Matting is algorithmic and does not accept a model identity',
    );
    const config = parseChromaKeyConfig(input.spec.config);
    const decoded = decodePngToRgba8(input.bytes);
    const pixels = decoded.pixels.slice();
    applyChromaKey(pixels, config);
    return {bytes: encodeRgbaPng({...decoded, pixels})};
  }
}

/** Chroma key plus border-connected green removal and primary-subject component retention. */
export class BorderConnectedChromaKeyPoseFrameMattingProcessor implements PoseFrameProcessor {
  readonly id = 'chroma-key-matting';
  readonly version = '1.1.0';
  readonly stage = 'matted' as const;

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    if (
      input.spec.stage !== this.stage
      || input.spec.processor.name !== this.id
      || input.spec.processor.version !== this.version
    ) throw new PoseFrameProcessorContractError('Border-connected Chroma Key Matting processor binding is invalid');
    if (input.spec.model !== undefined) throw new PoseFrameProcessorContractError(
      'Border-connected Chroma Key Matting is algorithmic and does not accept a model identity',
    );
    const config = parseBorderConnectedChromaKeyConfig(input.spec.config);
    const decoded = decodePngToRgba8(input.bytes);
    const sourcePixels = decoded.pixels.slice();
    const pixels = decoded.pixels.slice();
    applyChromaKey(pixels, config);
    clearBorderConnectedGreen(pixels, sourcePixels, decoded.width, decoded.height, config.borderCleanup);
    retainPrimaryForeground(pixels, decoded.width, decoded.height, config.borderCleanup);
    suppressSurvivingEdgeSpill(pixels, decoded.width, decoded.height, config);
    return {bytes: encodeRgbaPng({...decoded, pixels})};
  }
}

export class DeterministicReferencePoseFrameProcessor implements PoseFrameProcessor {
  constructor(
    readonly stage: PoseFrameProcessStage,
    readonly id: string,
    readonly version: string,
  ) {}

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    const bytes = addPngTextChunk(input.bytes, 'pose-clip', `${this.stage}:${input.spec.processorSpecHash}`);
    if (this.stage !== 'anchored') return {bytes};
    if (typeof input.spec.config !== 'object' || input.spec.config === null || Array.isArray(input.spec.config)) {
      throw new PoseFrameProcessorContractError('Anchored Reference Processor requires config.anchors');
    }
    const anchors = PoseAnchorsSchema.safeParse(input.spec.config.anchors);
    if (!anchors.success) throw new PoseFrameProcessorContractError(
      'Anchored Reference Processor config.anchors is invalid',
      {cause: anchors.error},
    );
    return {bytes, anchors: anchors.data};
  }
}
