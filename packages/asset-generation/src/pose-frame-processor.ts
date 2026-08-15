import type {
  PoseAnchors,
  PoseFrameProcessStage,
  PoseFrameProcessorSpec,
} from '@pose-clip/schemas';

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

export class DeterministicReferencePoseFrameProcessor implements PoseFrameProcessor {
  constructor(
    readonly stage: PoseFrameProcessStage,
    readonly id: string,
    readonly version: string,
    private readonly anchors?: PoseAnchors,
  ) {}

  async process(input: PoseFrameProcessorInput): Promise<PoseFrameProcessorOutput> {
    const suffix = new TextEncoder().encode(`\npose-clip:${this.stage}:${input.spec.processorSpecHash}`);
    const bytes = new Uint8Array(input.bytes.length + suffix.length);
    bytes.set(input.bytes);
    bytes.set(suffix, input.bytes.length);
    return {
      bytes,
      ...(this.anchors === undefined ? {} : {anchors: structuredClone(this.anchors)}),
    };
  }
}
