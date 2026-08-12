import './styles.css';
import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {createPaperPixiApplication, exportCanonicalPngDataUrl, PaperPixiRenderer} from '@pose-clip/paper-pixi';
import {createRendererFeasibilityPlan} from './render-plan.js';

interface PixelComparison {
  frame: number;
  width: number;
  height: number;
  differingPixels: number;
  maxChannelDelta: number;
}

interface FrameProfile {
  frame: number;
  evaluationMs: number;
  pixiRenderMs: number;
  pngEncodeMs: number;
  dataUrl: string;
}

interface RendererEnvironment {
  userAgent: string;
  webglVersion: string;
  vendor: string;
  renderer: string;
  unmaskedVendor: string | null;
  unmaskedRenderer: string | null;
}

interface RendererFeasibilityApi {
  ready: boolean;
  applyFrame(frame: number): void;
  applySequence(frames: number[]): void;
  exportFrameDataUrl(frame: number): Promise<string>;
  exportCurrentDataUrl(): string;
  previewFrameDataUrl(frame: number): string;
  comparePreviewAndExport(frame: number): Promise<PixelComparison>;
  compareDataUrls(left: string, right: string, frame: number): Promise<PixelComparison>;
  profileFrame(frame: number): FrameProfile;
  rendererEnvironment(): RendererEnvironment;
}

declare global {
  interface Window { rendererFeasibility: RendererFeasibilityApi; }
}

const plan = createRendererFeasibilityPlan();
const prepared = prepareRenderPlan(plan);
const application = await createPaperPixiApplication();
const renderer = new PaperPixiRenderer(application);
await renderer.preload(plan);
document.querySelector('#canvas-host')!.appendChild(application.canvas);

function applyFrame(frame: number): void {
  const bounded = Math.max(0, Math.min(prepared.plan.timeline.durationFrames - 1, Math.trunc(frame)));
  renderer.apply(evaluateFrame(prepared, bounded));
  document.querySelector('#frame-value')!.textContent = String(bounded);
  const slider = document.querySelector<HTMLInputElement>('#frame');
  if (slider !== null) slider.value = String(bounded);
}

function profileFrame(frame: number): FrameProfile {
  const bounded = Math.max(0, Math.min(prepared.plan.timeline.durationFrames - 1, Math.trunc(frame)));
  const evaluationStart = performance.now();
  const state = evaluateFrame(prepared, bounded);
  const evaluationEnd = performance.now();
  renderer.apply(state);
  const renderEnd = performance.now();
  const dataUrl = exportCanonicalPngDataUrl(application);
  const exportEnd = performance.now();
  return {
    frame: bounded,
    evaluationMs: evaluationEnd - evaluationStart,
    pixiRenderMs: renderEnd - evaluationEnd,
    pngEncodeMs: exportEnd - renderEnd,
    dataUrl,
  };
}

async function dataUrlPixels(dataUrl: string): Promise<ImageData> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (context === null) throw new Error('2D context unavailable');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function comparePreviewAndExport(frame: number): Promise<PixelComparison> {
  applyFrame(frame);
  const preview = await dataUrlPixels(application.canvas.toDataURL('image/png'));
  const offline = await dataUrlPixels(await exportCanonicalPngDataUrl(application));
  return comparePixelData(preview, offline, frame);
}

function comparePixelData(left: ImageData, right: ImageData, frame: number): PixelComparison {
  const preview = left;
  const offline = right;
  if (preview.width !== offline.width || preview.height !== offline.height) throw new Error('Preview/export dimensions differ');
  let differingPixels = 0;
  let maxChannelDelta = 0;
  for (let index = 0; index < preview.data.length; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((preview.data[index + channel] ?? 0) - (offline.data[index + channel] ?? 0));
      if (delta > 0) pixelDiffers = true;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (pixelDiffers) differingPixels += 1;
  }
  return {frame, width: preview.width, height: preview.height, differingPixels, maxChannelDelta};
}

async function compareDataUrls(left: string, right: string, frame: number): Promise<PixelComparison> {
  return comparePixelData(await dataUrlPixels(left), await dataUrlPixels(right), frame);
}

function rendererEnvironment(): RendererEnvironment {
  const gl = application.canvas.getContext('webgl2') ?? application.canvas.getContext('webgl');
  if (gl === null) throw new Error('Pixi WebGL context unavailable');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    webglVersion: String(gl.getParameter(gl.VERSION)),
    vendor: String(gl.getParameter(gl.VENDOR)),
    renderer: String(gl.getParameter(gl.RENDERER)),
    unmaskedVendor: debug === null ? null : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
    unmaskedRenderer: debug === null ? null : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
  };
}

window.rendererFeasibility = {
  ready: true,
  applyFrame,
  applySequence(frames) { for (const frame of frames) applyFrame(frame); },
  async exportFrameDataUrl(frame) { applyFrame(frame); return exportCanonicalPngDataUrl(application); },
  exportCurrentDataUrl() { return exportCanonicalPngDataUrl(application); },
  previewFrameDataUrl(frame) { applyFrame(frame); return application.canvas.toDataURL('image/png'); },
  comparePreviewAndExport,
  compareDataUrls,
  profileFrame,
  rendererEnvironment,
};

const slider = document.querySelector<HTMLInputElement>('#frame')!;
slider.addEventListener('input', () => applyFrame(Number(slider.value)));
document.querySelector<HTMLButtonElement>('#export')!.addEventListener('click', async () => {
  const anchor = document.createElement('a');
  anchor.download = `frame-${slider.value.padStart(3, '0')}.png`;
  anchor.href = await window.rendererFeasibility.exportFrameDataUrl(Number(slider.value));
  anchor.click();
});
document.querySelector('#status')!.textContent = `WebGL ready · ${application.canvas.width}×${application.canvas.height}`;
if (new URLSearchParams(location.search).get('automation') !== '1') applyFrame(0);
