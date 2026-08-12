import type {RenderPlan, VisualAssetRecord} from '@pose-clip/schemas';
import {goldenFixtureV2} from '../../../packages/paper-engine/test/fixture.ts';

function svgDataUrl(asset: VisualAssetRecord): string {
  const palette: Record<string, string> = {
    'farm-far': '#b9d9dc', 'farm-mid': '#91ad78', 'farm-ground': '#d6bd75', 'farm-foreground': '#4e633d',
    'farmer-walk-left': '#c76e42', 'farmer-walk-right': '#d6814f', 'farmer-hold-rabbit': '#b95f3f',
    'rabbit-idle': '#efe4d0', 'lantern-idle': '#f3b43f',
  };
  const color = palette[asset.id] ?? '#d8cbb4';
  const isEnvironment = asset.kind === 'environment-layer';
  const content = isEnvironment
    ? environmentSvg(asset.id, asset.width, asset.height, color)
    : characterSvg(asset.id, asset.width, asset.height, color);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

function environmentSvg(id: string, width: number, height: number, color: string): string {
  if (id === 'farm-far') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="1020" cy="135" r="72" fill="#f5dc8b"/><path d="M0 410 Q260 240 520 410 T1040 390 T1280 390 V720 H0Z" fill="#78966c"/></svg>`;
  if (id === 'farm-mid') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 450 Q180 330 350 440 T720 420 T1040 430 T1280 400 V720 H0Z" fill="${color}"/><g fill="#526847"><rect x="170" y="280" width="18" height="180"/><circle cx="180" cy="270" r="70"/><rect x="1090" y="300" width="16" height="165"/><circle cx="1100" cy="285" r="62"/></g></svg>`;
  if (id === 'farm-ground') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 500 H1280 V720 H0Z" fill="${color}"/><g stroke="#b49a5d" stroke-width="5" opacity=".65"><path d="M40 585 Q320 520 610 585 T1240 575" fill="none"/><path d="M0 650 Q300 590 650 650 T1280 635" fill="none"/></g></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 720 V500 Q60 420 115 510 V720Z" fill="${color}"/><path d="M1280 720 V470 Q1215 390 1160 500 V720Z" fill="${color}"/><g fill="#728558"><circle cx="90" cy="520" r="48"/><circle cx="1200" cy="490" r="56"/></g></svg>`;
}

function characterSvg(id: string, width: number, height: number, color: string): string {
  if (id === 'rabbit-idle') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="${color}" stroke="#6c5b4e" stroke-width="4"><ellipse cx="62" cy="68" rx="48" ry="29"/><ellipse cx="88" cy="38" rx="22" ry="24"/><ellipse cx="82" cy="12" rx="8" ry="22"/><ellipse cx="98" cy="14" rx="7" ry="22"/></g><circle cx="95" cy="36" r="3" fill="#29221e"/></svg>`;
  if (id === 'lantern-idle') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M18 16 Q30 2 42 16" fill="none" stroke="#4b3324" stroke-width="5"/><rect x="11" y="18" width="38" height="70" rx="12" fill="${color}" stroke="#6e4628" stroke-width="5"/><rect x="20" y="30" width="20" height="45" fill="#ffe8a2" opacity=".8"/></svg>`;
  const holding = id === 'farmer-hold-rabbit';
  const stride = id === 'farmer-walk-left' ? -18 : 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g stroke="#5b3829" stroke-width="12" stroke-linecap="round"><line x1="${width * .5}" y1="245" x2="${width * .5 + stride}" y2="382"/><line x1="${width * .5}" y1="245" x2="${width * .5 - stride}" y2="382"/><line x1="${width * .48}" y1="150" x2="${holding ? width * .68 : width * .76}" y2="220"/></g><path d="M${width * .28} 132 Q${width * .5} 100 ${width * .7} 132 L${width * .64} 285 H${width * .34}Z" fill="${color}" stroke="#69402d" stroke-width="6"/><circle cx="${width * .5}" cy="82" r="48" fill="#d9a775"/><path d="M${width * .25} 61 H${width * .75} Q${width * .68} 15 ${width * .5} 18 Q${width * .32} 15 ${width * .25} 61" fill="#80643e"/>${holding ? `<ellipse cx="${width * .63}" cy="205" rx="42" ry="28" fill="#eee2cd" stroke="#6c5b4e" stroke-width="5"/>` : ''}</svg>`;
}

export function createRendererFeasibilityPlan(): RenderPlan {
  const plan = structuredClone(goldenFixtureV2);
  plan.timeline.durationFrames = 300;
  plan.timeline.shots[0]!.range.endFrame = 300;
  for (const instance of plan.instances) instance.activeRange.endFrame = 300;
  for (const asset of plan.assets.assets) {
    if ('width' in asset) asset.uri = svgDataUrl(asset);
  }
  return plan;
}
