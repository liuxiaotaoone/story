import type {ActionGenerationRequest, VisualAssetRecord} from '@pose-clip/schemas';

export interface GeneratedImageArtifact {
  readonly bytes: Uint8Array;
  readonly filePath: string;
  readonly asset: VisualAssetRecord;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
}

export interface ImageGenerationProvider {
  readonly id: string;
  generate(request: ActionGenerationRequest): Promise<GeneratedImageArtifact[]>;
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
