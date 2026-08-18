import type {ActionGenerationRequest, VisualAssetRecord} from '@pose-clip/schemas';

export interface GeneratedImageArtifact {
  readonly bytes: Uint8Array;
  readonly filePath?: string;
  readonly asset: VisualAssetRecord;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
}

export interface ImageGenerationProvider {
  readonly id: string;
  generate(request: ActionGenerationRequest): Promise<GeneratedImageArtifact[]>;
}

export interface GenerationSubmission {
  readonly generationInputHash: string;
  readonly promptId: string;
}

export interface ResumableImageGenerationProvider extends ImageGenerationProvider {
  submit(request: ActionGenerationRequest): Promise<GenerationSubmission>;
  collect(
    request: ActionGenerationRequest,
    submission: GenerationSubmission,
  ): Promise<GeneratedImageArtifact[]>;
}

export function isResumableImageGenerationProvider(
  provider: ImageGenerationProvider,
): provider is ResumableImageGenerationProvider {
  const candidate = provider as Partial<ResumableImageGenerationProvider>;
  return typeof candidate.submit === 'function' && typeof candidate.collect === 'function';
}

export type MockImageGenerator = (
  request: ActionGenerationRequest,
) => Promise<GeneratedImageArtifact[]>;

export class MockImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'mock';

  constructor(private readonly generator: MockImageGenerator) {}

  generate(request: ActionGenerationRequest): Promise<GeneratedImageArtifact[]> {
    return this.generator(request);
  }
}
