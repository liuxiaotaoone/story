import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {createPaperPixiApplication, exportCanonicalPngDataUrl, PaperPixiRenderer} from '@pose-clip/paper-pixi';
import {RenderPlanSchema} from '@pose-clip/schemas';

interface M2RendererApi {
  ready: boolean;
  durationFrames: number;
  exportFrame(frame: number): {dataUrl: string; visibleEntityIds: string[]};
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

function exportFrame(frame: number) {
  const bounded = Math.max(0, Math.min(plan.timeline.durationFrames - 1, Math.trunc(frame)));
  const state = evaluateFrame(prepared, bounded);
  renderer.apply(state);
  document.querySelector('#status')!.textContent = `Frame ${bounded}/${plan.timeline.durationFrames - 1} · ${state.subtitle?.text ?? ''}`;
  return {
    dataUrl: exportCanonicalPngDataUrl(application),
    visibleEntityIds: state.sprites
      .filter(sprite => sprite.visible && sprite.entityId !== undefined)
      .map(sprite => sprite.entityId!),
  };
}

window.m2VerticalSlice = {ready: true, durationFrames: plan.timeline.durationFrames, exportFrame};
exportFrame(0);
