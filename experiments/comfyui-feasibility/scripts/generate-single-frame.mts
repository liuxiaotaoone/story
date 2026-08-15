import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ComfyUiProvider} from '@pose-clip/asset-generation';
import {RuntimeModelDependencySchema, createActionGenerationRequest, sha256Bytes} from '@pose-clip/schemas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowId = 'flux2-klein-reference-single-frame-v1';
const workflowPath = resolve(root, 'workflows', `${workflowId}.api.json`);
const modelCatalogPath = resolve(root, 'model-catalog.arc130t.json');
const referencePath = resolve(root, '..', 'asset-feasibility', 'processed', 'rabbit', 'rabbit-reference.png');
const outputRoot = resolve(root, 'generated');
const workflowBytes = await readFile(workflowPath);
const referenceBytes = await readFile(referencePath);
const modelCatalog = JSON.parse(new TextDecoder().decode(await readFile(modelCatalogPath))) as {
  models: Array<{role: 'diffusion-model' | 'text-encoder' | 'vae'; modelId: string; contentHash: string}>;
};
const runtimeModels = modelCatalog.models.map((model) => RuntimeModelDependencySchema.parse(model));

const request = await createActionGenerationRequest({
  schemaVersion: '1.0.0',
  actionPackageId: 'rabbit.idle',
  entityType: 'rabbit',
  action: 'idle',
  direction: 'left',
  workflowId,
  workflowHash: await sha256Bytes(workflowBytes),
  provider: 'comfyui',
  runtimeModels,
  prompt: [
    'Use the reference rabbit as the exact character identity and paper-cut watercolor style.',
    'Create one complete whole-body rabbit in a calm idle pose, facing left.',
    'Keep cream fur, pink inner ears and nose, brown outline and round proportions.',
    'All ears and paws visible, centered, no crop, plain uniform bright green background.',
  ].join(' '),
  negativePrompt: 'cropped body, missing feet, extra limbs, duplicate rabbit, text, scenery, shadow, photorealistic',
  seed: 20260813,
  referenceAssets: [{assetId: 'rabbit.reference', contentHash: await sha256Bytes(referenceBytes)}],
  output: {assetId: 'rabbit.idle-left.comfyui.01', kind: 'animal-frame', nodeId: '17', expectedCount: 1},
});

const provider = new ComfyUiProvider({
  endpoint: process.env.COMFYUI_ENDPOINT ?? 'http://127.0.0.1:8188',
  outputRoot,
  workflowResolver: async (requestedId) => {
    if (requestedId !== workflowId) throw new Error(`Unknown workflow: ${requestedId}`);
    return workflowBytes;
  },
  referenceResolver: async (assetId) => {
    if (assetId !== 'rabbit.reference') throw new Error(`Unknown reference asset: ${assetId}`);
    return {bytes: referenceBytes, filename: 'rabbit-reference.png'};
  },
  timeoutMs: 20 * 60_000,
});

const artifacts = process.env.COMFYUI_PROMPT_ID === undefined
  ? await provider.generate(request)
  : await provider.collectCompleted(request, process.env.COMFYUI_PROMPT_ID);
await mkdir(outputRoot, {recursive: true});
await writeFile(resolve(outputRoot, 'generation-request.json'), `${JSON.stringify(request, null, 2)}\n`);
await writeFile(resolve(outputRoot, 'artifact-manifest.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  requestInputHash: request.inputHash,
  workflowHash: request.workflowHash,
  assets: artifacts.map(({asset, providerMetadata}) => ({asset, providerMetadata})),
}, null, 2)}\n`);

console.log(JSON.stringify({
  status: 'PASS',
  requestInputHash: request.inputHash,
  artifacts: artifacts.map(({asset, filePath}) => ({id: asset.id, filePath, contentHash: asset.contentHash})),
}, null, 2));
