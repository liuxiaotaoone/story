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
const outputRoot = join(experimentRoot, 'output', 'candidate-real');
const framesRoot = join(outputRoot, 'frames');
const videoPath = join(outputRoot, 'rabbit-real-candidate-4s.mp4');
const trackedReportPath = join(workspaceRoot, 'experiments', 'comfyui-feasibility', 'reports', 'first-real-mp4.json');
const reviewVideoRoot = join(workspaceRoot, 'experiments', 'comfyui-feasibility', 'review', 'first-real-mp4');
const reviewVideoPath = join(reviewVideoRoot, 'rabbit-real-candidate-4s.mp4');
const integrationReportPath = join(workspaceRoot, 'experiments', 'comfyui-feasibility', 'reports', 'candidate-paper-engine-integration.json');

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
await mkdir(framesRoot, {recursive: true});
const server = await createServer({
  root: experimentRoot,
  server: {host: '127.0.0.1', port: 4174, strictPort: true},
  logLevel: 'warn',
});
await server.listen();

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'],
});

const startedAt = performance.now();
let frameCount = 0;
let rendererEnvironment;
const frameHashes = [];
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  page.on('console', message => {
    if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`);
  });
  await page.goto('http://127.0.0.1:4174/?automation=1&candidate=1', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.rendererFeasibility?.ready === true);
  frameCount = await page.evaluate(() => window.rendererFeasibility.durationFrames);
  rendererEnvironment = await page.evaluate(() => window.rendererFeasibility.rendererEnvironment());

  for (let frame = 0; frame < frameCount; frame += 1) {
    const dataUrl = await page.evaluate(frameNumber => window.rendererFeasibility.exportFrameDataUrl(frameNumber), frame);
    const bytes = dataUrlToBuffer(dataUrl);
    const fileName = `frame-${String(frame).padStart(3, '0')}.png`;
    await writeFile(join(framesRoot, fileName), bytes);
    frameHashes.push(sha256(bytes));
    if ([0, 3, 6, 9].includes(frame)) await writeFile(join(outputRoot, fileName), bytes);
  }
  await page.close();
} finally {
  await browser.close();
  await server.close();
}

const renderMs = performance.now() - startedAt;
const ffmpegStartedAt = performance.now();
await run(findFfmpeg(), [
  '-y', '-hide_banner', '-loglevel', 'warning',
  '-framerate', '30',
  '-i', join(framesRoot, 'frame-%03d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  videoPath,
], experimentRoot);
const encodeMs = performance.now() - ffmpegStartedAt;

const integration = JSON.parse(await readFile(integrationReportPath, 'utf8'));
const videoBytes = await readFile(videoPath);
const videoStats = await stat(videoPath);
await mkdir(reviewVideoRoot, {recursive: true});
await writeFile(reviewVideoPath, videoBytes);
const report = {
  schemaVersion: '1.0.0',
  gate: 'First Real Candidate PoseClip MP4',
  status: 'PASS',
  source: {
    candidateProfileHash: integration.candidateProfileHash,
    productionResultHash: integration.sourceProductionResultHash,
    poseClipHash: integration.poseClipHash,
    renderPlanHash: integration.renderPlanHash,
  },
  render: {
    engine: 'Paper Engine → Paper Pixi → canonical PNG sequence',
    width: 1280,
    height: 720,
    fps: 30,
    frames: frameCount,
    durationSeconds: frameCount / 30,
    frameSequenceHash: sha256(Buffer.from(JSON.stringify(frameHashes))),
    representativeFrames: [0, 3, 6, 9],
    renderer: rendererEnvironment.unmaskedRenderer ?? rendererEnvironment.renderer,
    vendor: rendererEnvironment.unmaskedVendor ?? rendererEnvironment.vendor,
    renderMs,
  },
  video: {
    codec: 'libx264',
    pixelFormat: 'yuv420p',
    contentHash: sha256(videoBytes),
    bytes: videoStats.size,
    encodeMs,
    fileName: 'rabbit-real-candidate-4s.mp4',
    reviewFileName: 'review/first-real-mp4/rabbit-real-candidate-4s.mp4',
  },
  reviewScope: [
    'GroundLock stability using contact=both and referenceFoot=midpoint',
    'Visible pose/identity/silhouette discontinuity at real playback speed',
    'Loop closure from frame 3 to frame 0',
  ],
};
await writeFile(join(outputRoot, 'first-real-mp4.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(trackedReportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`First real MP4: ${videoPath}\nVideo SHA-256: ${report.video.contentHash}\n`);
