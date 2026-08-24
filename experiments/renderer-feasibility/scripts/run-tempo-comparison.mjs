import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import process from 'node:process';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

const experimentRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(experimentRoot, '..', '..');
const outputRoot = join(experimentRoot, 'output', 'tempo-comparison');
const evidenceRoot = join(workspaceRoot, 'experiments', 'comfyui-feasibility');
const reviewRoot = join(evidenceRoot, 'review', 'tempo-comparison');
const reportPath = join(evidenceRoot, 'reports', 'pose-tempo-comparison.json');
const integrationReportPath = join(evidenceRoot, 'reports', 'candidate-paper-engine-integration.json');
const variants = [
  {tempo: '0.8', label: '0.8s', poseDurations: [6, 6, 6, 6]},
  {tempo: '1.0', label: '1.0s', poseDurations: [7, 8, 7, 8]},
  {tempo: '1.2', label: '1.2s', poseDurations: [9, 9, 9, 9]},
];

function findChrome() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const executable = candidates.find(candidate => existsSync(candidate));
  if (executable === undefined) throw new Error('Chrome/Edge executable not found');
  return executable;
}

function findFfmpeg() {
  if (process.env.POSE_CLIP_FFMPEG && existsSync(process.env.POSE_CLIP_FFMPEG)) return process.env.POSE_CLIP_FFMPEG;
  return 'ffmpeg';
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {cwd, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid PNG data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

await rm(outputRoot, {recursive: true, force: true});
await mkdir(outputRoot, {recursive: true});
await mkdir(reviewRoot, {recursive: true});
const server = await createServer({
  root: experimentRoot,
  server: {host: '127.0.0.1', port: 4175, strictPort: true},
  logLevel: 'warn',
});
await server.listen();
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'],
});

const integration = JSON.parse(await readFile(integrationReportPath, 'utf8'));
const renderedVariants = [];
let rendererEnvironment;
try {
  for (const variant of variants) {
    const variantOutputRoot = join(outputRoot, variant.label);
    const framesRoot = join(variantOutputRoot, 'frames');
    await mkdir(framesRoot, {recursive: true});
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
    page.on('console', message => {
      if (message.type() === 'error') process.stderr.write(`[browser:${variant.label}] ${message.text()}\n`);
    });
    const renderStartedAt = performance.now();
    await page.goto(`http://127.0.0.1:4175/?automation=1&candidate=1&tempo=${variant.tempo}`, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => window.rendererFeasibility?.ready === true);
    const frameCount = await page.evaluate(() => window.rendererFeasibility.durationFrames);
    if (rendererEnvironment === undefined) {
      rendererEnvironment = await page.evaluate(() => window.rendererFeasibility.rendererEnvironment());
    }
    const frameHashes = [];
    for (let frame = 0; frame < frameCount; frame += 1) {
      const dataUrl = await page.evaluate(frameNumber => window.rendererFeasibility.exportFrameDataUrl(frameNumber), frame);
      const bytes = dataUrlToBuffer(dataUrl);
      await writeFile(join(framesRoot, `frame-${String(frame).padStart(3, '0')}.png`), bytes);
      frameHashes.push(sha256(bytes));
    }
    await page.close();
    const renderMs = performance.now() - renderStartedAt;
    const videoFileName = `rabbit-real-tempo-${variant.label}.mp4`;
    const videoPath = join(variantOutputRoot, videoFileName);
    const encodeStartedAt = performance.now();
    await run(findFfmpeg(), [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-framerate', '30',
      '-i', join(framesRoot, 'frame-%03d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      videoPath,
    ], experimentRoot);
    const encodeMs = performance.now() - encodeStartedAt;
    const videoBytes = await readFile(videoPath);
    const videoStats = await stat(videoPath);
    await writeFile(join(reviewRoot, videoFileName), videoBytes);
    const planEvidence = integration.tempoExperiment.variants.find(candidate => candidate.label === variant.label);
    if (planEvidence === undefined) throw new Error(`Missing RenderPlan evidence for ${variant.label}`);
    renderedVariants.push({
      label: variant.label,
      reviewOnly: true,
      isolation: 'playback-tempo-only-no-crossfade',
      poseDurations: variant.poseDurations,
      cycleFrames: variant.poseDurations.reduce((sum, duration) => sum + duration, 0),
      cycleSeconds: Number(variant.tempo),
      comparisonCycles: 3,
      frameCount,
      durationSeconds: frameCount / 30,
      sourcePoseClipHash: integration.poseClipHash,
      reviewPoseClipHash: planEvidence.poseClipHash,
      renderPlanHash: planEvidence.renderPlanHash,
      frameSequenceHash: sha256(Buffer.from(JSON.stringify(frameHashes))),
      video: {
        fileName: videoFileName,
        contentHash: sha256(videoBytes),
        bytes: videoStats.size,
        codec: 'libx264',
        pixelFormat: 'yuv420p',
      },
      timingsMs: {render: renderMs, encode: encodeMs},
    });
  }
} finally {
  await browser.close();
  await server.close();
}

const report = {
  schemaVersion: '1.0.0',
  gate: 'PoseClip Playback Tempo Isolation Experiment',
  status: 'PASS',
  source: {
    candidateProfileHash: integration.candidateProfileHash,
    productionResultHash: integration.sourceProductionResultHash,
    poseClipHash: integration.poseClipHash,
    sharedFrameAssets: integration.frames.map(frame => ({
      frameIndex: frame.frameIndex,
      assetId: frame.assetId,
      contentHash: frame.contentHash,
    })),
  },
  controls: {
    samePngBytes: true,
    sameMattingNormalizeAnchor: true,
    sameGroundLockAndCamera: true,
    crossfade: false,
    transitionFrames: false,
    changedVariable: 'PoseClip frame duration only',
  },
  renderer: {
    width: 1280,
    height: 720,
    fps: 30,
    renderer: rendererEnvironment.unmaskedRenderer ?? rendererEnvironment.renderer,
    vendor: rendererEnvironment.unmaskedVendor ?? rendererEnvironment.vendor,
  },
  variants: renderedVariants,
  humanPreference: 'pending',
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${renderedVariants.map(variant => `${variant.label}: ${variant.video.contentHash}`).join('\n')}\n`);
