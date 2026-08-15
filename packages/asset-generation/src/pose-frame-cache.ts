import type {
  PoseAnchors,
  PoseClipFrameProductionResult,
  VisualAssetRecord,
} from '@pose-clip/schemas';
import type {GeneratedImageArtifact, GenerationSubmission} from './provider.js';

function cloneAsset(asset: VisualAssetRecord): VisualAssetRecord {
  return structuredClone(asset);
}

function cloneGenerated(artifact: GeneratedImageArtifact): GeneratedImageArtifact {
  return {
    bytes: artifact.bytes.slice(),
    filePath: artifact.filePath,
    asset: cloneAsset(artifact.asset),
    providerMetadata: structuredClone(artifact.providerMetadata),
  };
}

export interface CachedPoseFrameStageOutput {
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
  readonly alphaMode: 'straight' | 'opaque';
  readonly createdAt: string;
  readonly anchors?: PoseAnchors;
}

function cloneStageOutput(output: CachedPoseFrameStageOutput): CachedPoseFrameStageOutput {
  return {
    ...output,
    bytes: output.bytes.slice(),
    ...(output.anchors === undefined ? {} : {anchors: structuredClone(output.anchors)}),
  };
}

export interface PoseFrameGenerationCache {
  get(generationInputHash: string): Promise<GeneratedImageArtifact | undefined>;
  set(generationInputHash: string, artifact: GeneratedImageArtifact): Promise<void>;
}

export interface PoseFrameGenerationResumeCache {
  get(generationInputHash: string): Promise<GenerationSubmission | undefined>;
  set(generationInputHash: string, submission: GenerationSubmission): Promise<void>;
  delete(generationInputHash: string): Promise<void>;
}

export interface PoseFrameStageCache {
  get(stageCacheKey: string): Promise<CachedPoseFrameStageOutput | undefined>;
  set(stageCacheKey: string, output: CachedPoseFrameStageOutput): Promise<void>;
}

export interface PoseFrameResultCache {
  get(frameExecutionKey: string): Promise<PoseClipFrameProductionResult | undefined>;
  set(frameExecutionKey: string, result: PoseClipFrameProductionResult): Promise<void>;
}

export class InMemoryPoseFrameGenerationCache implements PoseFrameGenerationCache {
  readonly #entries = new Map<string, GeneratedImageArtifact>();

  async get(key: string): Promise<GeneratedImageArtifact | undefined> {
    const value = this.#entries.get(key);
    return value === undefined ? undefined : cloneGenerated(value);
  }

  async set(key: string, artifact: GeneratedImageArtifact): Promise<void> {
    this.#entries.set(key, cloneGenerated(artifact));
  }
}

export class InMemoryPoseFrameGenerationResumeCache implements PoseFrameGenerationResumeCache {
  readonly #entries = new Map<string, GenerationSubmission>();

  async get(key: string): Promise<GenerationSubmission | undefined> {
    const value = this.#entries.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async set(key: string, submission: GenerationSubmission): Promise<void> {
    this.#entries.set(key, structuredClone(submission));
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }
}

export class InMemoryPoseFrameStageCache implements PoseFrameStageCache {
  readonly #entries = new Map<string, CachedPoseFrameStageOutput>();

  async get(key: string): Promise<CachedPoseFrameStageOutput | undefined> {
    const value = this.#entries.get(key);
    return value === undefined ? undefined : cloneStageOutput(value);
  }

  async set(key: string, output: CachedPoseFrameStageOutput): Promise<void> {
    this.#entries.set(key, cloneStageOutput(output));
  }
}

export class InMemoryPoseFrameResultCache implements PoseFrameResultCache {
  readonly #entries = new Map<string, PoseClipFrameProductionResult>();

  async get(key: string): Promise<PoseClipFrameProductionResult | undefined> {
    const value = this.#entries.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async set(key: string, result: PoseClipFrameProductionResult): Promise<void> {
    this.#entries.set(key, structuredClone(result));
  }
}
