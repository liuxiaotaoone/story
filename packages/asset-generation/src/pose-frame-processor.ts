import type {
  PoseAnchors,
  PoseFrameProcessStage,
  PoseFrameProcessorSpec,
} from '@pose-clip/schemas';
import {PoseAnchorsSchema} from '@pose-clip/schemas';

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

export class DeterministicReferencePoseFrameProcessor implements PoseFrameProcessor {
  constructor(
    readonly stage: PoseFrameProcessStage,
    readonly id: string,
    readonly version: string,
  ) {}

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    const suffix = new TextEncoder().encode(`\npose-clip:${this.stage}:${input.spec.processorSpecHash}`);
    const bytes = new Uint8Array(input.bytes.length + suffix.length);
    bytes.set(input.bytes);
    bytes.set(suffix, input.bytes.length);
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
