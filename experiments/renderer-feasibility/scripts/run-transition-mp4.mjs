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
const evidenceRoot = join(workspaceRoot, 'experiments', 'comfyui-feasibility');
const requestedVariant = process.argv.find(argument => argument.startsWith('--variant='))?.slice('--variant='.length) ?? '100ms';
if (!['67ms', '100ms'].includes(requestedVariant)) throw new Error(`Unsupported Transition variant: ${requestedVariant}`);
const is67ms = requestedVariant === '67ms';
const transitionFrames = is67ms ? 2 : 3;
const transitionMilliseconds = is67ms ? 2000 / 30 : 100;
const outputRoot = join(experimentRoot, 'output', is67ms ? 'candidate-transition-67ms' : 'candidate-transition');
const framesRoot = join(outputRoot, 'frames');
const reviewRoot = join(evidenceRoot, 'review', 'pose-transition');
const videoFileName = `rabbit-real-tempo-1.0s-transition-${requestedVariant}.mp4`;
const videoPath = join(outputRoot, videoFileName);
const reportPath = join(evidenceRoot, 'reports', is67ms ? 'pose-transition-67ms-video.json' : 'pose-transition-video.json');
const planReportPath = join(evidenceRoot, 'reports', is67ms ? 'pose-transition-67ms-plan.json' : 'pose-transition-plan.json');
const tempoReportPath = join(evidenceRoot, 'reports', 'pose-tempo-comparison.json');

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
await mkdir(reviewRoot, {recursive: true});
const server = await createServer({
  root: experimentRoot,
  server: {host: '127.0.0.1', port: 4176, strictPort: true},
  logLevel: 'warn',
});
await server.listen();
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'],
});

const frameHashes = [];
let rendererEnvironment;
let frameCount = 0;
const renderStartedAt = performance.now();
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  page.on('console', message => {
    if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`);
  });
  await page.goto(`http://127.0.0.1:4176/?automation=1&candidate=1&transition=${is67ms ? '67' : '100'}`, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.rendererFeasibility?.ready === true);
  frameCount = await page.evaluate(() => window.rendererFeasibility.durationFrames);
  rendererEnvironment = await page.evaluate(() => window.rendererFeasibility.rendererEnvironment());
  for (let frame = 0; frame < frameCount; frame += 1) {
    const dataUrl = await page.evaluate(frameNumber => window.rendererFeasibility.exportFrameDataUrl(frameNumber), frame);
    const bytes = dataUrlToBuffer(dataUrl);
    await writeFile(join(framesRoot, `frame-${String(frame).padStart(3, '0')}.png`), bytes);
    frameHashes.push(sha256(bytes));
    if ((is67ms ? [4, 5, 6, 7] : [3, 4, 5, 6, 7]).includes(frame)) {
      await writeFile(join(outputRoot, `transition-0-1-frame-${String(frame).padStart(3, '0')}.png`), bytes);
    }
  }
  await page.close();
} finally {
  await browser.close();
  await server.close();
}
const renderMs = performance.now() - renderStartedAt;
const encodeStartedAt = performance.now();
await run(findFfmpeg(), [
  '-y', '-hide_banner', '-loglevel', 'warning',
  '-framerate', '30',
  '-i', join(framesRoot, 'frame-%03d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  videoPath,
], experimentRoot);
const encodeMs = performance.now() - encodeStartedAt;

const [planReport, tempoReport, videoBytes] = await Promise.all([
  readFile(planReportPath, 'utf8').then(JSON.parse),
  readFile(tempoReportPath, 'utf8').then(JSON.parse),
  readFile(videoPath),
]);
const hardCut = tempoReport.variants.find(variant => variant.label === '1.0s');
if (hardCut === undefined) throw new Error('Missing 1.0s hard-cut comparison evidence');
await writeFile(join(reviewRoot, videoFileName), videoBytes);
const videoStats = await stat(videoPath);
const report = {
  schemaVersion: '1.0.0',
  gate: `1.0s + ${is67ms ? '67ms' : '100ms'} Pose Transition MP4`,
  status: 'PASS',
  reviewOnly: true,
  source: {
    transitionPlanResultHash: planReport.transitionPlanResultHash,
    transitionRenderPlanHash: planReport.renderPlanHash,
    ...(is67ms
      ? {transition100msHumanReviewApprovalHash: planReport.source.transition100msHumanReviewApprovalHash}
      : {tempoPreferenceApprovalHash: planReport.source.tempoPreferenceApprovalHash}),
    hardCut1sVideoHash: hardCut.video.contentHash,
    hardCut1sRenderPlanHash: hardCut.renderPlanHash,
    frameContentHashes: planReport.source.frameContentHashes,
  },
  controls: {
    cycleFrames: 30,
    cycleSeconds: 1,
    comparisonCycles: 3,
    transitionType: 'crossfade',
    transitionFrames,
    transitionMilliseconds,
    anchorPolicy: 'foot',
    newGeneratedFrames: false,
    sourceAssetBytesChanged: false,
  },
  render: {
    width: 1280,
    height: 720,
    fps: 30,
    frames: frameCount,
    durationSeconds: frameCount / 30,
    frameSequenceHash: sha256(Buffer.from(JSON.stringify(frameHashes))),
    renderer: rendererEnvironment.unmaskedRenderer ?? rendererEnvironment.renderer,
    vendor: rendererEnvironment.unmaskedVendor ?? rendererEnvironment.vendor,
    renderMs,
  },
  video: {
    fileName: videoFileName,
    contentHash: sha256(videoBytes),
    bytes: videoStats.size,
    codec: 'libx264',
    pixelFormat: 'yuv420p',
    encodeMs,
  },
  humanReview: 'pending',
  reviewQuestions: is67ms
    ? [
        'Does one primary 50/50 blend frame soften the hard cut without sustained double-rabbit ghosting?',
        'Is 67ms preferable to both the 1.0s hard-cut and rejected 100ms variants?',
        'Does foot-anchor transition placement remain visually grounded?',
      ]
    : [
        'Does the 100ms crossfade reduce hard-cut shock compared with the selected 1.0s baseline?',
        'Does structural mismatch create unacceptable double-rabbit ghosting?',
        'Does foot-anchor transition placement remain visually grounded?',
      ],
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Transition MP4: ${join(reviewRoot, videoFileName)}\nVideo SHA-256: ${report.video.contentHash}\n`);
