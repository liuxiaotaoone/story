import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import process from 'node:process';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {parseBenchmarkArgs} from './benchmark-args.mjs';

const experimentRoot = resolve(import.meta.dirname, '..');
const outputRoot = join(experimentRoot, 'output');
const frameCount = 300;
const criticalFrames = [3, 20, 31, 50, 70, 90];
const historyFrames = [0, 20, 31, 50, 79, 100];
const {mode, skipFfmpeg, externalFfmpegMs} = parseBenchmarkArgs(process.argv.slice(2));
const modeOutputRoot = join(outputRoot, mode);
const framesRoot = join(modeOutputRoot, 'frames');

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

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid PNG data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const totalMs = samples.reduce((sum, sample) => sum + sample, 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    totalMs,
    averageMsPerFrame: totalMs / samples.length,
    p95MsPerFrame: sorted[p95Index] ?? 0,
  };
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {cwd, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function openRendererPage(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  page.on('console', message => {
    if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`);
  });
  await page.goto('http://127.0.0.1:4173/?automation=1', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.rendererFeasibility?.ready === true);
  return page;
}

async function verifyHistoryIndependence(browser) {
  const start = performance.now();
  const comparisons = [];
  for (const frame of criticalFrames) {
    const directPage = await openRendererPage(browser);
    const historyPage = await openRendererPage(browser);
    try {
      const direct = await directPage.evaluate(frameNumber => window.rendererFeasibility.exportFrameDataUrl(frameNumber), frame);
      const sequence = [...historyFrames.filter(candidate => candidate !== frame), frame];
      await historyPage.evaluate(frames => window.rendererFeasibility.applySequence(frames), sequence);
      const afterHistory = await historyPage.evaluate(() => window.rendererFeasibility.exportCurrentDataUrl());
      const comparison = await directPage.evaluate(
        ({left, right, frameNumber}) => window.rendererFeasibility.compareDataUrls(left, right, frameNumber),
        {left: direct, right: afterHistory, frameNumber: frame},
      );
      comparisons.push({...comparison, priorFrames: sequence.slice(0, -1)});
      if (comparison.differingPixels !== 0 || comparison.maxChannelDelta !== 0) {
        await writeFile(join(modeOutputRoot, `determinism-${frame}-direct.png`), dataUrlToBuffer(direct));
        await writeFile(join(modeOutputRoot, `determinism-${frame}-history.png`), dataUrlToBuffer(afterHistory));
        throw new Error(`Renderer history changed frame ${frame}: ${JSON.stringify(comparison)}`);
      }
    } finally {
      await directPage.close();
      await historyPage.close();
    }
  }
  return {comparisons, elapsedMs: performance.now() - start};
}

await rm(modeOutputRoot, {recursive: true, force: true});
await mkdir(framesRoot, {recursive: true});
const server = await createServer({
  root: experimentRoot,
  server: {host: '127.0.0.1', port: 4173, strictPort: true},
  logLevel: 'warn',
});
await server.listen();

const browserArgs = ['--enable-webgl', '--ignore-gpu-blocklist'];
if (mode === 'swiftshader') browserArgs.push('--use-angle=swiftshader');
else browserArgs.push('--enable-gpu');
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: browserArgs,
});

let report;
let framePipelineStartedAt;
try {
  const determinism = await verifyHistoryIndependence(browser);
  framePipelineStartedAt = performance.now();
  const page = await openRendererPage(browser);
  try {
    const environment = await page.evaluate(() => window.rendererFeasibility.rendererEnvironment());
    const evaluationSamples = [];
    const pixiSubmitSamples = [];
    const browserPngExportSamples = [];
    const frameWriteSamples = [];

    // Warm shader compilation and texture upload before measuring steady-state frames.
    await page.evaluate(() => window.rendererFeasibility.applyFrame(0));
    for (let frame = 0; frame < frameCount; frame += 1) {
      const profile = await page.evaluate(frameNumber => window.rendererFeasibility.profileFrame(frameNumber), frame);
      evaluationSamples.push(profile.evaluationMs);
      pixiSubmitSamples.push(profile.pixiSubmitMs);
      browserPngExportSamples.push(profile.browserPngExportMs);
      const fileName = `frame-${String(frame).padStart(3, '0')}.png`;
      const bytes = dataUrlToBuffer(profile.dataUrl);
      const writeStart = performance.now();
      await writeFile(join(framesRoot, fileName), bytes);
      const writeMs = performance.now() - writeStart;
      frameWriteSamples.push(writeMs);
      if (frame === 0 || frame === 30 || frame === 60) await writeFile(join(modeOutputRoot, fileName), bytes);
    }

    report = {
      environment: {
        mode,
        renderer: environment.unmaskedRenderer ?? environment.renderer,
        vendor: environment.unmaskedVendor ?? environment.vendor,
        webglVersion: environment.webglVersion,
        userAgent: environment.userAgent,
        width: 1280,
        height: 720,
        fps: 30,
        frames: frameCount,
      },
      determinism: {
        comparison: 'decoded-rgba-exact-equality',
        elapsedMs: determinism.elapsedMs,
        criticalFrames: determinism.comparisons,
      },
      evaluation: summarize(evaluationSamples),
      pixiSubmit: summarize(pixiSubmitSamples),
      browserPngExport: {
        ...summarize(browserPngExportSamples),
        includes: ['gpu-completion-wait', 'framebuffer-readback', 'png-encode', 'base64-encode'],
      },
      frameWrite: summarize(frameWriteSamples),
      ffmpeg: {encodeMs: null},
      total: {framePipelineElapsedMs: null, elapsedMs: null},
    };
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (framePipelineStartedAt === undefined) throw new Error('Frame Pipeline did not start');
report.total.framePipelineElapsedMs = performance.now() - framePipelineStartedAt;

if (!skipFfmpeg) {
  const ffmpegStart = performance.now();
  await run(findFfmpeg(), [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-framerate', '30',
    '-i', join(framesRoot, 'frame-%03d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(modeOutputRoot, 'renderer-feasibility-10s.mp4'),
  ], experimentRoot);
  report.ffmpeg.encodeMs = performance.now() - ffmpegStart;
}
if (externalFfmpegMs !== null) report.ffmpeg.encodeMs = externalFfmpegMs;
report.total.elapsedMs = report.total.framePipelineElapsedMs + (report.ffmpeg.encodeMs ?? 0);
await writeFile(join(modeOutputRoot, 'renderer-gate-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Renderer Gate (${mode}) artifacts: ${modeOutputRoot}\n`);
