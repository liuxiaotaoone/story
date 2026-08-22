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

export const CHROMA_KEY_MATTING_MODEL = {
  modelId: 'chroma-key-euclidean-rgba-v1',
  contentHash: '5b3479f1858f837acbcc9345f6a77201af4a3469b5ac0c280d496e77eaa3d94c',
} as const;

export interface ChromaKeyMattingConfig {
  readonly keyColor: readonly [number, number, number];
  readonly transparentThreshold: number;
  readonly opaqueThreshold: number;
  readonly spillSuppression: number;
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

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
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
    if (
      input.spec.model?.modelId !== CHROMA_KEY_MATTING_MODEL.modelId
      || input.spec.model.contentHash !== CHROMA_KEY_MATTING_MODEL.contentHash
    ) throw new PoseFrameProcessorContractError('Chroma Key Matting model identity is invalid');
    const config = parseChromaKeyConfig(input.spec.config);
    const decoded = decodePngToRgba8(input.bytes);
    const pixels = decoded.pixels.slice();
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
