import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ComfyUiProvider} from '@pose-clip/asset-generation';
import {RuntimeModelDependencySchema, createActionGenerationRequest, sha256Bytes} from '@pose-clip/schemas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowId = 'flux2-klein-reference-single-frame-v1';
const workflowBytes = await readFile(resolve(root, 'workflows', `${workflowId}.api.json`));
const referenceBytes = await readFile(resolve(root, '..', 'asset-feasibility', 'processed', 'rabbit', 'rabbit-reference.png'));
const modelCatalog = JSON.parse(new TextDecoder().decode(await readFile(resolve(root, 'model-catalog.arc130t.json')))) as {
  models: Array<{role: 'diffusion-model' | 'text-encoder' | 'vae'; modelId: string; contentHash: string}>;
};
const runtimeModels = modelCatalog.models.map((model) => RuntimeModelDependencySchema.parse(model));
const outputRoot = resolve(root, 'generated', 'reliability');
const reportPath = resolve(root, 'reports', 'reliability-gate.json');
const endpoint = process.env.COMFYUI_ENDPOINT ?? 'http://127.0.0.1:8188';
const referenceHash = await sha256Bytes(referenceBytes);
const workflowHash = await sha256Bytes(workflowBytes);
const jobs = Array.from({length: 5}, (_, index) => ({
  jobId: `reliability-${index + 1}`,
  seed: 20260821 + index,
  assetId: `rabbit.idle-left.reliability.${index + 1}`,
}));

const provider = new ComfyUiProvider({
  endpoint,
  outputRoot,
  workflowResolver: async (requestedId) => {
    if (requestedId !== workflowId) throw new Error(`Unknown workflow: ${requestedId}`);
    return workflowBytes;
  },
  referenceResolver: async (assetId) => {
    if (assetId !== 'rabbit.reference') throw new Error(`Unknown reference asset: ${assetId}`);
    return {bytes: referenceBytes};
  },
  timeoutMs: 20 * 60_000,
});

const startedAt = new Date();
const results: Array<Record<string, unknown>> = [];
for (const job of jobs) {
  const request = await createActionGenerationRequest({
    schemaVersion: '1.0.0', actionPackageId: 'rabbit.idle', entityType: 'rabbit', action: 'idle', direction: 'left',
    workflowId, workflowHash, provider: 'comfyui', runtimeModels,
    prompt: 'Use the reference rabbit as the exact identity. One complete whole-body paper-cut watercolor rabbit, calm idle pose, facing left, all ears and paws visible, centered, uniform bright green background.',
    negativePrompt: 'cropped body, missing feet, extra limbs, duplicate rabbit, text, scenery, photorealistic',
    seed: job.seed,
    referenceAssets: [{assetId: 'rabbit.reference', contentHash: referenceHash}],
    output: {assetId: job.assetId, kind: 'animal-frame', nodeId: '17', expectedCount: 1},
  });
  const jobStarted = performance.now();
  let result: Record<string, unknown>;
  try {
    const [artifact] = await provider.generate(request);
    if (artifact === undefined) throw new Error('Provider returned no artifact');
    result = {
      jobId: job.jobId, status: 'PASS', attemptCount: 1, seed: job.seed,
      inputHash: request.inputHash, promptId: artifact.providerMetadata.promptId,
      assetId: artifact.asset.id, contentHash: artifact.asset.contentHash,
      width: artifact.asset.width, height: artifact.asset.height,
      elapsedMs: performance.now() - jobStarted, errors: [],
    };
  } catch (error) {
    result = {
      jobId: job.jobId, status: 'FAIL', attemptCount: 1, seed: job.seed,
      inputHash: request.inputHash, elapsedMs: performance.now() - jobStarted,
      errors: [{message: error instanceof Error ? error.message : String(error)}],
    };
  }
  try {
    await provider.releaseResources();
    result.recoveryAction = {action: 'comfyui-free', status: 'PASS'};
  } catch (error) {
    result.recoveryAction = {action: 'comfyui-free', status: 'FAIL', message: error instanceof Error ? error.message : String(error)};
  }
  results.push(result);
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 3_000));
  if (result.status === 'FAIL') break;
}

const passed = results.filter((result) => result.status === 'PASS');
const hashes = new Set(passed.map((result) => result.contentHash));
const report = {
  schemaVersion: '1.0.0',
  status: results.length === 5 && passed.length === 5 && hashes.size === 5 ? 'PASS' : 'FAIL',
  policy: {requiredJobs: 5, maxAttemptsPerJob: 1, automaticRetry: false, sequential: true},
  environment: {endpoint, width: 512, height: 768, steps: 6, runtimeModels},
  workflowId, workflowHash, referenceAsset: {assetId: 'rabbit.reference', contentHash: referenceHash},
  startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
  completedJobs: passed.length, uniqueContentHashes: hashes.size,
  jobs: results,
};
await mkdir(dirname(reportPath), {recursive: true});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
