import './style.css';
import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {createPaperPixiApplication, exportCanonicalPngDataUrl, PaperPixiRenderer} from '@pose-clip/paper-pixi';
import {createAssetGateRenderPlan} from './demo-render-plan.js';

interface AssetGateDemoApi {
  ready: boolean;
  applyFrame(frame: number): void;
  exportFrameDataUrl(frame: number): string;
}

declare global {
  interface Window { assetGateDemo: AssetGateDemoApi; }
}

const plan = createAssetGateRenderPlan();
const prepared = prepareRenderPlan(plan);
const application = await createPaperPixiApplication();
const renderer = new PaperPixiRenderer(application);
await renderer.preload(plan);
document.querySelector('#demo-canvas-host')!.appendChild(application.canvas);

const slider = document.querySelector<HTMLInputElement>('#demo-frame')!;
const frameValue = document.querySelector<HTMLOutputElement>('#demo-frame-value')!;
const status = document.querySelector<HTMLParagraphElement>('#demo-status')!;
const playButton = document.querySelector<HTMLButtonElement>('#demo-play')!;
let currentFrame = 0;
let playing = false;
let lastTick = performance.now();

function applyFrame(frame: number): void {
  currentFrame = Math.max(0, Math.min(299, Math.trunc(frame)));
  const state = evaluateFrame(prepared, currentFrame);
  renderer.apply(state);
  slider.value = String(currentFrame);
  frameValue.value = String(currentFrame);
  status.textContent = `Frame ${currentFrame} / 299 · ${state.sprites.length} sprites · ${state.subtitle?.text ?? '无字幕'}`;
}

function tick(now: number): void {
  if (playing && now - lastTick >= 1000 / 30) {
    const elapsedFrames = Math.max(1, Math.floor((now - lastTick) / (1000 / 30)));
    applyFrame((currentFrame + elapsedFrames) % 300);
    lastTick = now;
  }
  requestAnimationFrame(tick);
}

window.assetGateDemo = {
  ready: true,
  applyFrame,
  exportFrameDataUrl(frame) { applyFrame(frame); return exportCanonicalPngDataUrl(application); },
};

slider.addEventListener('input', () => applyFrame(Number(slider.value)));
playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? 'Pause' : 'Play';
  lastTick = performance.now();
});
document.querySelector<HTMLButtonElement>('#demo-export')!.addEventListener('click', () => {
  const anchor = document.createElement('a');
  anchor.download = `asset-gate-frame-${String(currentFrame).padStart(3, '0')}.png`;
  anchor.href = window.assetGateDemo.exportFrameDataUrl(currentFrame);
  anchor.click();
});
requestAnimationFrame(tick);
if (new URLSearchParams(location.search).get('automation') !== '1') applyFrame(0);
