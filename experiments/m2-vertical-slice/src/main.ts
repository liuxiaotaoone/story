import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {createPaperPixiApplication, exportCanonicalPngDataUrl, PaperPixiRenderer} from '@pose-clip/paper-pixi';
import {RenderPlanSchema} from '@pose-clip/schemas';

interface PixelStats {
  totalPixelCount: number;
  nonTransparentPixelCount: number;
  nonBlackPixelCount: number;
  rgbaSha256?: string;
}

interface M2RendererApi {
  ready: boolean;
  durationFrames: number;
  exportFrame(frame: number, includeRgbaHash?: boolean): Promise<{dataUrl: string; pixelStats: PixelStats}>;
}

declare global { interface Window { m2VerticalSlice: M2RendererApi; } }

const response = await fetch('/artifacts/render-plan.json');
if (!response.ok) throw new Error(`RenderPlan fetch failed: ${response.status}`);
const plan = RenderPlanSchema.parse(await response.json());
const prepared = prepareRenderPlan(plan);
const application = await createPaperPixiApplication();
const renderer = new PaperPixiRenderer(application);
await renderer.preload(plan);
document.querySelector('#canvas-host')!.appendChild(application.canvas);

async function inspectExportedPng(dataUrl: string, includeRgbaHash: boolean): Promise<PixelStats> {
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (context === null) throw new Error('2D canvas is unavailable for PNG pixel inspection');
  context.drawImage(image, 0, 0);
  image.close();
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonTransparentPixelCount = 0;
  let nonBlackPixelCount = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) continue;
    nonTransparentPixelCount += 1;
    if (rgba[offset]! > 4 || rgba[offset + 1]! > 4 || rgba[offset + 2]! > 4) nonBlackPixelCount += 1;
  }
  let rgbaSha256: string | undefined;
  if (includeRgbaHash) {
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(rgba));
    rgbaSha256 = [...new Uint8Array(digest)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }
  return {
    totalPixelCount: rgba.length / 4,
    nonTransparentPixelCount,
    nonBlackPixelCount,
    ...(rgbaSha256 === undefined ? {} : {rgbaSha256}),
  };
}

async function exportFrame(frame: number, includeRgbaHash = false) {
  const bounded = Math.max(0, Math.min(plan.timeline.durationFrames - 1, Math.trunc(frame)));
  const state = evaluateFrame(prepared, bounded);
  renderer.apply(state);
  document.querySelector('#status')!.textContent = `Frame ${bounded}/${plan.timeline.durationFrames - 1} · ${state.subtitle?.text ?? ''}`;
  const dataUrl = exportCanonicalPngDataUrl(application);
  return {dataUrl, pixelStats: await inspectExportedPng(dataUrl, includeRgbaHash)};
}

await exportFrame(0);
window.m2VerticalSlice = {ready: true, durationFrames: plan.timeline.durationFrames, exportFrame};
