import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  VisualAssetRecordSchema,
  canonicalHash,
  contentAddressedAssetUri,
  sha256Bytes,
  type ActionGenerationRequest,
} from '@pose-clip/schemas';
import {
  AssetGenerationIntegrityError,
  AssetGenerationTransientError,
  assertGenerationRequestIntegrity,
} from './integrity.js';
import {inspectPng} from './png.js';
import type {GeneratedImageArtifact, ImageGenerationProvider} from './provider.js';

type JsonRecord = Record<string, unknown>;

export interface ResolvedGenerationReference {
  bytes: Uint8Array;
  filename?: string;
}

export interface ComfyUiProviderOptions {
  endpoint: string;
  outputRoot: string;
  workflowResolver: (workflowId: string) => Promise<Uint8Array>;
  referenceResolver?: (assetId: string) => Promise<ResolvedGenerationReference>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface ComfyImageDescriptor {
  filename: string;
  subfolder: string;
  type: string;
  nodeId: string;
}

interface GenerationOutputSelector {
  nodeId: string;
  expectedCount: 1;
}

function asRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be a JSON object`);
  }
  return value as JsonRecord;
}

function safeName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (name.length === 0 || name === '.' || name === '..') throw new TypeError(`Unsafe generated asset id: ${value}`);
  return name;
}

function endpointUrl(endpoint: string, path: string): URL {
  return new URL(path, endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
}

function materializeWorkflow(value: unknown, replacements: ReadonlyMap<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => materializeWorkflow(item, replacements));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materializeWorkflow(item, replacements)]));
  }
  if (typeof value !== 'string') return value;
  const replacement = replacements.get(value);
  if (replacement !== undefined) return replacement;
  if (value.includes('{{')) throw new TypeError(`Unresolved ComfyUI workflow placeholder: ${value}`);
  return value;
}

async function responseJson(response: Response, context: string): Promise<unknown> {
  if (!response.ok) {
    const message = `${context} failed with HTTP ${response.status}: ${await response.text()}`;
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new AssetGenerationTransientError('GENERATION_HTTP_TRANSIENT', message);
    }
    throw new AssetGenerationIntegrityError('GENERATION_HTTP_PERMANENT', message);
  }
  return response.json();
}

function collectImages(
  history: JsonRecord,
  promptId: string,
  selector: GenerationOutputSelector,
): ComfyImageDescriptor[] | undefined {
  const entryValue = history[promptId];
  if (entryValue === undefined) return undefined;
  const entry = asRecord(entryValue, `ComfyUI history ${promptId}`);
  const status = entry.status === undefined ? undefined : asRecord(entry.status, 'ComfyUI history status');
  if (status?.status_str === 'error') {
    const messages = Array.isArray(status.messages) ? status.messages : [];
    const executionError = messages.find((message) => Array.isArray(message) && message[0] === 'execution_error');
    const details = Array.isArray(executionError) && executionError[1] !== undefined
      ? asRecord(executionError[1], 'ComfyUI execution error')
      : undefined;
    const node = typeof details?.node_id === 'string' ? ` at node ${details.node_id}` : '';
    const reason = typeof details?.exception_message === 'string' ? `: ${details.exception_message.trim()}` : '';
    throw new Error(`ComfyUI prompt ${promptId} failed${node}${reason}`);
  }
  const outputs = entry.outputs === undefined ? undefined : asRecord(entry.outputs, 'ComfyUI history outputs');
  if (outputs === undefined) return undefined;

  const selectedOutput = outputs[selector.nodeId];
  const selectedImages = selectedOutput === undefined
    ? []
    : asRecord(selectedOutput, `ComfyUI output ${selector.nodeId}`).images;
  const imageValues = Array.isArray(selectedImages) ? selectedImages : [];
  if (imageValues.length !== selector.expectedCount) {
    throw new AssetGenerationIntegrityError(
      'GENERATION_OUTPUT_COUNT_MISMATCH',
      `ComfyUI output node ${selector.nodeId} returned ${imageValues.length} images; expected ${selector.expectedCount}`,
    );
  }
  return imageValues.map((item) => {
    const image = asRecord(item, `ComfyUI output image ${selector.nodeId}`);
    if (typeof image.filename !== 'string') throw new TypeError('ComfyUI output image lacks filename');
    return {
      filename: image.filename,
      subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
      type: typeof image.type === 'string' ? image.type : 'output',
      nodeId: selector.nodeId,
    };
  });
}

export class ComfyUiProvider implements ImageGenerationProvider {
  readonly id = 'comfyui';
  readonly #fetch: typeof globalThis.fetch;
  readonly #pollIntervalMs: number;
  readonly #timeoutMs: number;

  constructor(private readonly options: ComfyUiProviderOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#timeoutMs = options.timeoutMs ?? 10 * 60_000;
    if (this.#pollIntervalMs < 0 || this.#timeoutMs <= 0) throw new TypeError('Invalid ComfyUI polling configuration');
  }

  async #request(input: URL, init?: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(input, init);
    } catch (error) {
      throw new AssetGenerationTransientError(
        'GENERATION_TRANSPORT_FAILURE',
        `ComfyUI request failed: ${input.pathname}`,
        {cause: error},
      );
    }
  }

  async releaseResources(): Promise<void> {
    const response = await this.#request(endpointUrl(this.options.endpoint, 'free'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({unload_models: true, free_memory: true}),
    });
    if (!response.ok) {
      const message = `Release ComfyUI resources failed with HTTP ${response.status}: ${await response.text()}`;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new AssetGenerationTransientError('GENERATION_HTTP_TRANSIENT', message);
      }
      throw new AssetGenerationIntegrityError('GENERATION_HTTP_PERMANENT', message);
    }
  }

  async #uploadReferences(request: ActionGenerationRequest): Promise<Map<string, string>> {
    const uploaded = new Map<string, string>();
    for (const reference of request.referenceAssets) {
      if (this.options.referenceResolver === undefined) {
        throw new AssetGenerationIntegrityError(
          'GENERATION_REFERENCE_RESOLVER_MISSING',
          `Reference asset ${reference.assetId} cannot be resolved`,
        );
      }
      const resolved = await this.options.referenceResolver(reference.assetId);
      const contentHash = await sha256Bytes(resolved.bytes);
      if (contentHash !== reference.contentHash) {
        throw new AssetGenerationIntegrityError(
          'GENERATION_REFERENCE_HASH_MISMATCH',
          `Reference asset ${reference.assetId} bytes do not match contentHash`,
        );
      }
      const form = new FormData();
      const filename = `${safeName(reference.assetId)}-${contentHash.slice(0, 16)}.png`;
      form.set('image', new Blob([resolved.bytes.slice().buffer as ArrayBuffer], {type: 'image/png'}), filename);
      form.set('type', 'input');
      form.set('overwrite', 'true');
      const response = await this.#request(endpointUrl(this.options.endpoint, 'upload/image'), {method: 'POST', body: form});
      const result = asRecord(await responseJson(response, `Upload reference ${reference.assetId}`), 'ComfyUI upload response');
      if (typeof result.name !== 'string') throw new TypeError('ComfyUI upload response lacks image name');
      const subfolder = typeof result.subfolder === 'string' ? result.subfolder : '';
      uploaded.set(reference.assetId, subfolder.length === 0 ? result.name : `${subfolder}/${result.name}`);
    }
    return uploaded;
  }

  async #waitForImages(
    promptId: string,
    selector: GenerationOutputSelector,
  ): Promise<ComfyImageDescriptor[]> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.#timeoutMs) {
      const response = await this.#request(endpointUrl(this.options.endpoint, `history/${encodeURIComponent(promptId)}`));
      const history = asRecord(await responseJson(response, `Read ComfyUI history ${promptId}`), 'ComfyUI history response');
      const images = collectImages(history, promptId, selector);
      if (images !== undefined) return images;
      await new Promise<void>((resolve) => setTimeout(resolve, this.#pollIntervalMs));
    }
    throw new AssetGenerationTransientError(
      'GENERATION_TIMEOUT',
      `ComfyUI prompt ${promptId} timed out after ${this.#timeoutMs}ms`,
    );
  }

  async #downloadArtifacts(
    request: ActionGenerationRequest,
    promptId: string,
    images: readonly ComfyImageDescriptor[],
  ): Promise<GeneratedImageArtifact[]> {
    await mkdir(this.options.outputRoot, {recursive: true});
    const promptHash = await canonicalHash('image-generation-prompt-v1', {
      prompt: request.prompt,
      negativePrompt: request.negativePrompt ?? null,
    });
    const artifacts: GeneratedImageArtifact[] = [];
    for (const [index, image] of images.entries()) {
      const view = endpointUrl(this.options.endpoint, 'view');
      view.searchParams.set('filename', image.filename);
      view.searchParams.set('subfolder', image.subfolder);
      view.searchParams.set('type', image.type);
      const response = await this.#request(view);
      if (!response.ok) {
        const message = `Read ComfyUI output ${image.filename} failed with HTTP ${response.status}`;
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new AssetGenerationTransientError('GENERATION_HTTP_TRANSIENT', message);
        }
        throw new AssetGenerationIntegrityError('GENERATION_HTTP_PERMANENT', message);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentHash = await sha256Bytes(bytes);
      const metadata = inspectPng(bytes);
      const suffix = images.length === 1 ? '' : `.${String(index + 1).padStart(2, '0')}`;
      const assetId = `${request.output.assetId}${suffix}`;
      const filePath = join(this.options.outputRoot, `${contentHash}.png`);
      await writeFile(filePath, bytes);
      const asset = VisualAssetRecordSchema.parse({
        id: assetId,
        kind: request.output.kind,
        uri: contentAddressedAssetUri(contentHash),
        contentHash,
        source: 'generated',
        provenance: {
          inputHash: request.inputHash,
          promptHash,
          modelId: request.runtimeModels.find((model) => model.role === 'diffusion-model')?.modelId,
          seed: request.seed,
          producer: {name: 'comfyui-provider', version: '0.1.2'},
          createdAt: (this.options.now ?? (() => new Date()))().toISOString(),
        },
        qaStatus: 'pending',
        ...metadata,
      });
      artifacts.push({
        bytes,
        filePath,
        asset,
        providerMetadata: {
          promptId,
          nodeId: image.nodeId,
          filename: image.filename,
          subfolder: image.subfolder,
          type: image.type,
          workflowId: request.workflowId,
          workflowHash: request.workflowHash,
        },
      });
    }
    return artifacts;
  }

  async collectCompleted(
    input: ActionGenerationRequest,
    promptId: string,
  ): Promise<GeneratedImageArtifact[]> {
    const request = await assertGenerationRequestIntegrity(input);
    const response = await this.#request(endpointUrl(this.options.endpoint, `history/${encodeURIComponent(promptId)}`));
    const history = asRecord(await responseJson(response, `Read ComfyUI history ${promptId}`), 'ComfyUI history response');
    const entry = asRecord(history[promptId], `ComfyUI history ${promptId}`);
    const promptRecord = Array.isArray(entry.prompt) && entry.prompt.length >= 4
      ? asRecord(entry.prompt[3], 'ComfyUI prompt metadata')
      : undefined;
    const expectedClientId = `pose-clip-${request.inputHash}`;
    if (
      promptRecord?.client_id !== expectedClientId
      || promptRecord.generationRequestHash !== request.inputHash
    ) {
      throw new AssetGenerationIntegrityError(
        'GENERATION_PROMPT_BINDING_MISMATCH',
        `ComfyUI prompt ${promptId} is not bound to Generation Request ${request.inputHash}`,
      );
    }
    const images = collectImages(history, promptId, request.output);
    if (images === undefined) throw new Error(`ComfyUI prompt ${promptId} has not completed`);
    return this.#downloadArtifacts(request, promptId, images);
  }

  async generate(input: ActionGenerationRequest): Promise<GeneratedImageArtifact[]> {
    const request = await assertGenerationRequestIntegrity(input);
    const workflowBytes = await this.options.workflowResolver(request.workflowId);
    const workflowHash = await sha256Bytes(workflowBytes);
    if (workflowHash !== request.workflowHash) {
      throw new AssetGenerationIntegrityError(
        'GENERATION_WORKFLOW_HASH_MISMATCH',
        `Workflow ${request.workflowId} bytes do not match workflowHash`,
      );
    }
    const workflow = JSON.parse(new TextDecoder().decode(workflowBytes)) as unknown;
    const uploaded = await this.#uploadReferences(request);
    const replacements = new Map<string, unknown>([
      ['{{prompt}}', request.prompt],
      ['{{negativePrompt}}', request.negativePrompt ?? ''],
      ['{{seed}}', request.seed],
      ['{{filenamePrefix}}', `pose-clip/${safeName(request.output.assetId)}`],
    ]);
    for (const model of request.runtimeModels) {
      replacements.set(`{{runtimeModel:${model.role}}}`, model.modelId);
    }
    for (const [assetId, filename] of uploaded) replacements.set(`{{reference:${assetId}}}`, filename);
    const prompt = asRecord(materializeWorkflow(workflow, replacements), 'Materialized ComfyUI workflow');

    const queueResponse = await this.#request(endpointUrl(this.options.endpoint, 'prompt'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        prompt,
        client_id: `pose-clip-${request.inputHash}`,
        extra_data: {generationRequestHash: request.inputHash},
      }),
    });
    const queue = asRecord(await responseJson(queueResponse, 'Queue ComfyUI prompt'), 'ComfyUI queue response');
    if (typeof queue.prompt_id !== 'string') throw new TypeError('ComfyUI queue response lacks prompt_id');
    const images = await this.#waitForImages(queue.prompt_id, request.output);
    return this.#downloadArtifacts(request, queue.prompt_id, images);
  }
}
