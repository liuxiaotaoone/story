import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import process from 'node:process';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

const experimentRoot = resolve(import.meta.dirname, '..');
const outputRoot = join(experimentRoot, 'output');
const framesRoot = join(outputRoot, 'frames');
const frameCount = 300;
const criticalFrames = [3, 20, 31, 50, 60, 79];

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

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid PNG data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {cwd, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await rm(outputRoot, {recursive: true, force: true});
await mkdir(framesRoot, {recursive: true});

const server = await createServer({
  root: experimentRoot,
  server: {host: '127.0.0.1', port: 4173, strictPort: true},
  logLevel: 'warn',
});
await server.listen();

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  page.on('console', message => {
    if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`);
  });
  await page.goto('http://127.0.0.1:4173', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.rendererFeasibility?.ready === true);

  const comparisons = [];
  for (const frame of criticalFrames) {
    const comparison = await page.evaluate(frameNumber => window.rendererFeasibility.comparePreviewAndExport(frameNumber), frame);
    comparisons.push(comparison);
    if (comparison.differingPixels !== 0 || comparison.maxChannelDelta !== 0) {
      const [previewDataUrl, exportDataUrl] = await Promise.all([
        page.evaluate(frameNumber => window.rendererFeasibility.previewFrameDataUrl(frameNumber), frame),
        page.evaluate(frameNumber => window.rendererFeasibility.exportFrameDataUrl(frameNumber), frame),
      ]);
      await writeFile(join(outputRoot, `mismatch-${frame}-preview.png`), dataUrlToBuffer(previewDataUrl));
      await writeFile(join(outputRoot, `mismatch-${frame}-export.png`), dataUrlToBuffer(exportDataUrl));
      throw new Error(`Preview/export mismatch at frame ${frame}: ${JSON.stringify(comparison)}`);
    }
  }

  for (let frame = 0; frame < frameCount; frame += 1) {
    const dataUrl = await page.evaluate(frameNumber => window.rendererFeasibility.exportFrameDataUrl(frameNumber), frame);
    const fileName = `frame-${String(frame).padStart(3, '0')}.png`;
    const bytes = dataUrlToBuffer(dataUrl);
    await writeFile(join(framesRoot, fileName), bytes);
    if (frame === 0 || frame === 30 || frame === 60) await writeFile(join(outputRoot, fileName), bytes);
  }

  await writeFile(join(outputRoot, 'renderer-gate-report.json'), `${JSON.stringify({
    renderer: 'pixi.js/webgl',
    canonicalSize: {width: 1280, height: 720},
    frameRate: 30,
    frameCount,
    previewScaleMode: 'post-render-css-only',
    comparisonThreshold: 'exact-rgba-equality',
    criticalFrameComparisons: comparisons,
  }, null, 2)}\n`);
} finally {
  await browser.close();
  await server.close();
}

await run('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'warning',
  '-framerate', '30',
  '-i', join(framesRoot, 'frame-%03d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  join(outputRoot, 'renderer-feasibility-10s.mp4'),
], experimentRoot);

process.stdout.write(`Renderer Gate artifacts: ${outputRoot}\n`);
