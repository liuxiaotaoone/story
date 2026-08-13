import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {evaluateCameraSafeBounds, evaluateCharacterScale, evaluateCoverage, evaluateStoryActions, evaluateVisualEventCadence, scanFreezeRuns} from '../src/quality-gates.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'output');
const frames = join(output, 'frames');
const generated = join(root, 'generated', 'artifacts');
const frozen = join(root, 'frozen');

function findChrome() {
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean);
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
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveCapture(stdout) : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
  });
}
function pngBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid PNG data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}
async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
function findFfmpeg() { return process.env.POSE_CLIP_FFMPEG ?? 'ffmpeg'; }
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
const renderPlan = JSON.parse(await readFile(join(generated, 'render-plan.json'), 'utf8'));
const generatedReport = JSON.parse(await readFile(join(generated, 'generation-report.json'), 'utf8'));
const visualEventFrames = [
  ...renderPlan.timeline.shots.map(shot => shot.range.startFrame),
  ...renderPlan.timeline.poseEvents.map(event => event.frame),
  ...renderPlan.timeline.visibilityEvents.map(event => event.frame),
  ...renderPlan.timeline.markers.map(marker => marker.frame),
  ...renderPlan.timeline.cameraTracks.flatMap(track => track.position.map(keyframe => keyframe.frame)),
];
const cadenceGate = evaluateVisualEventCadence(visualEventFrames, renderPlan.timeline.durationFrames);

const server = await createServer({root, server: {host: '127.0.0.1', port: 4176, strictPort: true}, logLevel: 'warn'});
await server.listen();
const browser = await chromium.launch({executablePath: findChrome(), headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader']});
const coverageFailures = [];
const frameHashes = [];
let minimumFrameCoverage = 1;
let minimumEdgeCoverage = 1;
let frameCount = 0;
try {
  const page = await browser.newPage({viewport: {width: 1360, height: 850}, deviceScaleFactor: 1});
  page.on('console', message => { if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`); });
  await page.goto('http://127.0.0.1:4176/?automation=1', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.m21VisualQuality?.ready === true);
  frameCount = await page.evaluate(() => window.m21VisualQuality.durationFrames);
  const stills = new Set([...visualEventFrames, 0, frameCount - 1].filter(frame => frame >= 0 && frame < frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const result = await page.evaluate(value => window.m21VisualQuality.exportFrame(value), frame);
    const coverage = evaluateCoverage(result.pixelStats);
    minimumFrameCoverage = Math.min(minimumFrameCoverage, coverage.frameCoverage);
    minimumEdgeCoverage = Math.min(minimumEdgeCoverage, coverage.edgeCoverage);
    if (!coverage.pass) coverageFailures.push({frame, ...coverage});
    frameHashes.push(result.pixelStats.rgbaSha256);
    const bytes = pngBytes(result.dataUrl);
    await writeFile(join(frames, `frame-${String(frame).padStart(4, '0')}.png`), bytes);
    if (stills.has(frame)) await writeFile(join(output, `frame-${String(frame).padStart(4, '0')}.png`), bytes);
  }
} finally {
  await browser.close();
  await server.close();
}
const freezeGate = scanFreezeRuns(frameHashes);
const storyActionGate = evaluateStoryActions(renderPlan);
const cameraSafeBoundsGate = evaluateCameraSafeBounds(renderPlan, generatedReport.visualContracts.cameraSafeBounds);
const characterScaleGate = evaluateCharacterScale(renderPlan);

const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg);
const silentVideo = join(output, 'm21-video-silent.mp4');
const finalVideo = join(output, 'm21-visual-acceptance.mp4');
await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'warning', '-framerate', '30', '-i', join(frames, 'frame-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentVideo]);
await run(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'warning', '-i', silentVideo, '-i', join(generated, 'narration-master.wav'), '-i', join(generated, 'subtitles.srt'),
  '-vf', 'ass=generated/artifacts/subtitles.ass', '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=zho', '-movflags', '+faststart', finalVideo,
]);
const probe = JSON.parse(await capture(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_frames,duration:stream_tags=language', '-of', 'json', finalVideo]));
const video = probe.streams.find(stream => stream.codec_type === 'video');
const audio = probe.streams.find(stream => stream.codec_type === 'audio');
const subtitle = probe.streams.find(stream => stream.codec_type === 'subtitle');
const videoDuration = Number(video?.duration ?? probe.format.duration);
const audioDuration = Number(audio?.duration ?? probe.format.duration);
const avDelta = Math.abs(videoDuration - audioDuration);
const technicalPass = coverageFailures.length === 0 && freezeGate.failures.length === 0 && cadenceGate.pass &&
  storyActionGate.pass && cameraSafeBoundsGate.pass && characterScaleGate.pass && generatedReport.tts.kind === 'real' &&
  video?.width === 1280 && video?.height === 720 && frameRate(video?.avg_frame_rate) === 30 && Number(video?.nb_frames) === frameCount && avDelta <= 1 / 30 && subtitle?.codec_name === 'mov_text';
const report = {
  status: technicalPass ? 'TECHNICAL_PASS_VISUAL_REVIEW_REQUIRED' : 'FAIL',
  artifact: 'm21-visual-acceptance.mp4',
  ...generatedReport,
  mp4Sha256: await sha256(finalVideo),
  coverageGate: {minimumRequired: 0.995, minimumFrameCoverage, minimumEdgeCoverage, failures: coverageFailures},
  freezeGate,
  visualEventCadenceGate: cadenceGate,
  storyActionGate,
  cameraSafeBoundsGate,
  characterScaleGate,
  subtitle: {assBurnIn: true, softTrack: subtitle?.codec_name, language: subtitle?.tags?.language},
  mediaProbe: {width: video?.width, height: video?.height, fps: frameRate(video?.avg_frame_rate), frames: Number(video?.nb_frames), durationSeconds: Number(probe.format.duration), videoCodec: video?.codec_name, pixelFormat: video?.pix_fmt, audioCodec: audio?.codec_name, avDurationDeltaSeconds: avDelta},
};
await writeFile(join(output, 'm21-visual-acceptance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!technicalPass) throw new Error('M2.1 technical visual quality gates failed');
await mkdir(frozen, {recursive: true});
await copyFile(join(generated, 'render-plan.json'), join(frozen, 'render-plan.golden.json'));
await copyFile(join(generated, 'director-plan.json'), join(frozen, 'director-plan.golden.json'));
await writeFile(join(frozen, 'technical-gate-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`M2.1 Technical Gate: ${finalVideo}\n`);
