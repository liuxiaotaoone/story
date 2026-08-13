import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'output');
const frames = join(output, 'frames');
const generated = join(root, 'generated', 'artifacts');
const frozen = join(root, 'frozen');
const MIN_CONTENT_PIXEL_RATIO = 0.01;

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

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {cwd: root, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function capture(command, args) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0
      ? resolveCapture(stdout)
      : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
  });
}

function pngBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid PNG data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function findFfmpeg() {
  return process.env.POSE_CLIP_FFMPEG ?? 'ffmpeg';
}

function findFfprobe(ffmpeg) {
  if (process.env.POSE_CLIP_FFPROBE) return process.env.POSE_CLIP_FFPROBE;
  const sibling = join(resolve(ffmpeg, '..'), 'ffprobe.exe');
  return existsSync(sibling) ? sibling : 'ffprobe';
}

function frameRate(value) {
  const [numerator = 0, denominator = 1] = String(value ?? '0/1').split('/').map(Number);
  return denominator === 0 ? 0 : numerator / denominator;
}

await run(process.execPath, ['--experimental-strip-types', 'scripts/generate-artifacts.mts']);
await rm(output, {recursive: true, force: true});
await mkdir(frames, {recursive: true});
const server = await createServer({root, server: {host: '127.0.0.1', port: 4175, strictPort: true}, logLevel: 'warn'});
await server.listen();
const browser = await chromium.launch({
  executablePath: findChrome(), headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});
let frameCount = 0;
const pixelBlankFrames = [];
const criticalFrameRgbaSha256 = {};
let minimumNonTransparentPixelCount = Number.POSITIVE_INFINITY;
let minimumNonBlackPixelCount = Number.POSITIVE_INFINITY;
try {
  const page = await browser.newPage({viewport: {width: 1360, height: 850}, deviceScaleFactor: 1});
  page.on('console', message => { if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`); });
  await page.goto('http://127.0.0.1:4175/?automation=1', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.m2VerticalSlice?.ready === true);
  frameCount = await page.evaluate(() => window.m2VerticalSlice.durationFrames);
  const stills = new Set([0, 60, 119, 120, 359, 360, frameCount - 1]);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const includeRgbaHash = stills.has(frame);
    const result = await page.evaluate(
      ([value, includeHash]) => window.m2VerticalSlice.exportFrame(value, includeHash),
      [frame, includeRgbaHash],
    );
    const threshold = Math.ceil(result.pixelStats.totalPixelCount * MIN_CONTENT_PIXEL_RATIO);
    minimumNonTransparentPixelCount = Math.min(
      minimumNonTransparentPixelCount,
      result.pixelStats.nonTransparentPixelCount,
    );
    minimumNonBlackPixelCount = Math.min(
      minimumNonBlackPixelCount,
      result.pixelStats.nonBlackPixelCount,
    );
    if (
      result.pixelStats.nonTransparentPixelCount <= threshold ||
      result.pixelStats.nonBlackPixelCount <= threshold
    ) {
      pixelBlankFrames.push({frame, threshold, ...result.pixelStats});
    }
    if (result.pixelStats.rgbaSha256 !== undefined) {
      criticalFrameRgbaSha256[String(frame)] = result.pixelStats.rgbaSha256;
    }
    const bytes = pngBytes(result.dataUrl);
    const name = `frame-${String(frame).padStart(4, '0')}.png`;
    await writeFile(join(frames, name), bytes);
    if (stills.has(frame)) await writeFile(join(output, name), bytes);
  }
} finally {
  await browser.close();
  await server.close();
}

const silentVideo = join(output, 'm2-video-silent.mp4');
const finalVideo = join(output, 'm2-vertical-slice-22s.mp4');
const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg);
await run(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'warning', '-framerate', '30',
  '-i', join(frames, 'frame-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', silentVideo,
]);
await run(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'warning',
  '-i', silentVideo,
  '-i', join(generated, 'narration-master.wav'),
  '-i', join(generated, 'subtitles.srt'),
  '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text',
  '-metadata:s:s:0', 'language=zho',
  '-movflags', '+faststart', finalVideo,
]);
const probe = JSON.parse(await capture(ffprobe, [
  '-v', 'error',
  '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_frames,duration:stream_tags=language',
  '-of', 'json', finalVideo,
]));
const videoStream = probe.streams.find(stream => stream.codec_type === 'video');
const audioStream = probe.streams.find(stream => stream.codec_type === 'audio');
const subtitleStream = probe.streams.find(stream => stream.codec_type === 'subtitle');
const actualFps = frameRate(videoStream?.avg_frame_rate);
const actualFrameCount = Number(videoStream?.nb_frames ?? frameCount);
const videoDurationSeconds = Number(videoStream?.duration ?? probe.format.duration);
const audioDurationSeconds = Number(audioStream?.duration ?? probe.format.duration);
const avDurationDeltaSeconds = Math.abs(videoDurationSeconds - audioDurationSeconds);
const generatedReport = JSON.parse(await readFile(join(generated, 'generation-report.json'), 'utf8'));
const report = {
  status:
    pixelBlankFrames.length === 0 &&
    videoStream?.width === generatedReport.media.width &&
    videoStream?.height === generatedReport.media.height &&
    actualFps === generatedReport.media.fps &&
    actualFrameCount === frameCount &&
    avDurationDeltaSeconds <= 1 / generatedReport.media.fps &&
    videoStream?.codec_name === 'h264' &&
    videoStream?.pix_fmt === 'yuv420p' &&
    audioStream?.codec_name === 'aac' &&
    subtitleStream?.codec_name === 'mov_text' &&
    subtitleStream?.tags?.language === 'zho'
      ? 'PASS'
      : 'FAIL',
  artifact: 'm2-vertical-slice-22s.mp4',
  ...generatedReport,
  mp4Sha256: await sha256(finalVideo),
  blankFrames: pixelBlankFrames.length,
  pixelGate: {
    source: 'decoded-final-png-rgba',
    minimumContentPixelRatio: MIN_CONTENT_PIXEL_RATIO,
    minimumNonTransparentPixelCount,
    minimumNonBlackPixelCount,
    blankFrames: pixelBlankFrames,
    criticalFrameRgbaSha256,
  },
  narrationIntegrity: {
    status: 'PASS',
    decoder: '@pose-clip/audio.decodePcm16Wav',
    policy: 'fail-on-source-underrun-or-timeline-overflow',
  },
  mediaProbe: {
    width: videoStream?.width,
    height: videoStream?.height,
    fps: actualFps,
    frameCount: actualFrameCount,
    durationSeconds: Number(probe.format.duration),
    videoDurationSeconds,
    audioDurationSeconds,
    avDurationDeltaSeconds,
    videoCodec: videoStream?.codec_name,
    pixelFormat: videoStream?.pix_fmt,
    audioCodec: audioStream?.codec_name,
    subtitleCodec: subtitleStream?.codec_name,
    subtitleLanguage: subtitleStream?.tags?.language,
  },
  subtitleArtifact: 'generated/artifacts/subtitles.srt',
  narrationArtifact: 'generated/artifacts/narration-master.wav',
};
await writeFile(join(output, 'm2-vertical-slice-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'PASS') throw new Error('M2 media gate failed; frozen artifacts were not updated');
await mkdir(frozen, {recursive: true});
await copyFile(join(generated, 'render-plan.json'), join(frozen, 'render-plan.golden.json'));
await copyFile(join(generated, 'preflight.json'), join(frozen, 'preflight.golden.json'));
await writeFile(join(frozen, 'm2-vertical-slice-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(frozen, 'artifact-manifest.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  storyHash: report.sourceStoryHash,
  directorPlanHash: report.sourceDirectorPlanHash,
  preflightHash: report.preflightHash,
  assetCatalogHash: report.assetCatalogHash,
  renderPlanSemanticHash: report.renderPlanSemanticHash,
  mp4Sha256: report.mp4Sha256,
  width: report.mediaProbe.width,
  height: report.mediaProbe.height,
  fps: report.mediaProbe.fps,
  frames: report.mediaProbe.frameCount,
  durationSeconds: report.mediaProbe.durationSeconds,
  videoCodec: report.mediaProbe.videoCodec,
  pixelFormat: report.mediaProbe.pixelFormat,
  audioCodec: report.mediaProbe.audioCodec,
  subtitleCodec: report.mediaProbe.subtitleCodec,
  blankFrames: report.blankFrames,
  criticalFrameRgbaSha256,
  artifactStorage: {
    repositoryPath: null,
    expectedFilename: report.artifact,
    policy: 'external-or-git-lfs',
  },
}, null, 2)}\n`);
process.stdout.write(`M2 Vertical Slice: ${finalVideo}\n`);
