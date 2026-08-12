import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'output');
const frames = join(output, 'frames');

function chromePath() {
  const values = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'), 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const result = values.find(value => existsSync(value));
  if (!result) throw new Error('Chrome/Edge executable not found');
  return result;
}

function writePng(dataUrl, path) {
  const comma = dataUrl.indexOf(',');
  return writeFile(path, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {cwd: root, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await rm(output, {recursive: true, force: true});
await mkdir(frames, {recursive: true});
const server = await createServer({root, server: {host: '127.0.0.1', port: 4174, strictPort: true}, logLevel: 'warn'});
await server.listen();
const browser = await chromium.launch({executablePath: chromePath(), headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader']});
try {
  const page = await browser.newPage({viewport: {width: 1360, height: 850}, deviceScaleFactor: 1});
  page.on('console', message => { if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`); });
  await page.goto('http://127.0.0.1:4174/demo.html?automation=1', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.assetGateDemo?.ready === true);
  const stillFrames = new Set([0, 3, 10, 15, 30, 60, 89, 90, 91, 92, 94, 97, 98, 149, 150, 151, 180, 206, 209, 210, 211, 212, 299]);
  for (let frame = 0; frame < 300; frame += 1) {
    const dataUrl = await page.evaluate(value => window.assetGateDemo.exportFrameDataUrl(value), frame);
    const name = `frame-${String(frame).padStart(3, '0')}.png`;
    await writePng(dataUrl, join(frames, name));
    if (stillFrames.has(frame)) await writePng(dataUrl, join(output, name));
  }
} finally {
  await browser.close();
  await server.close();
}
await run(process.env.POSE_CLIP_FFMPEG ?? 'ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-framerate', '30', '-i', join(frames, 'frame-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'm1-high-quality-demo-10s.mp4')]);
process.stdout.write(`Asset Gate demo: ${output}\n`);
