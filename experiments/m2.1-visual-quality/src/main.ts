import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {createPaperPixiApplication, exportCanonicalPngDataUrl, PaperPixiRenderer} from '@pose-clip/paper-pixi';
import {RenderPlanSchema} from '@pose-clip/schemas';

interface PixelStats {
  totalPixelCount: number;
  validPixelCount: number;
  edgeValidPixelCount: number;
  edgePixelCount: number;
  rgbaSha256: string;
}

interface RendererApi {
  ready: boolean;
  durationFrames: number;
  exportFrame(frame: number): Promise<{dataUrl: string; pixelStats: PixelStats}>;
}

declare global { interface Window { m21VisualQuality: RendererApi; } }

const response = await fetch('/artifacts/render-plan.json');
if (!response.ok) throw new Error(`RenderPlan fetch failed: ${response.status}`);
const plan = RenderPlanSchema.parse(await response.json());
const prepared = prepareRenderPlan(plan);
const application = await createPaperPixiApplication();
const renderer = new PaperPixiRenderer(application);
await renderer.preload(plan);
document.querySelector('#canvas-host')!.appendChild(application.canvas);

async function inspectPng(dataUrl: string): Promise<PixelStats> {
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (context === null) throw new Error('2D canvas unavailable');
  context.drawImage(image, 0, 0);
  image.close();
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let validPixelCount = 0;
  let edgeValidPixelCount = 0;
  let edgePixelCount = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const valid = rgba[offset + 3]! > 0 && (rgba[offset]! > 4 || rgba[offset + 1]! > 4 || rgba[offset + 2]! > 4);
      if (valid) validPixelCount += 1;
      const edge = x < 2 || x >= canvas.width - 2 || y < 2 || y >= canvas.height - 2;
      if (edge) {
        edgePixelCount += 1;
        if (valid) edgeValidPixelCount += 1;
      }
    }
  }
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(rgba));
  const rgbaSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return {totalPixelCount: rgba.length / 4, validPixelCount, edgeValidPixelCount, edgePixelCount, rgbaSha256};
}

async function exportFrame(frame: number) {
  const bounded = Math.max(0, Math.min(plan.timeline.durationFrames - 1, Math.trunc(frame)));
  const state = evaluateFrame(prepared, bounded);
  renderer.apply(state);
  document.querySelector('#status')!.textContent = `Frame ${bounded}/${plan.timeline.durationFrames - 1}`;
  const dataUrl = exportCanonicalPngDataUrl(application);
  return {dataUrl, pixelStats: await inspectPng(dataUrl)};
}

await exportFrame(0);
window.m21VisualQuality = {ready: true, durationFrames: plan.timeline.durationFrames, exportFrame};
