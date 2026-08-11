import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {evaluateFrame, prepareRenderPlan} from '../dist/index.js';
import {goldenFixtureV2} from './fixture.ts';

const GOLDEN_FRAMES = [
  3, 4, 5,
  19, 20, 21,
  29, 30, 31,
  49, 50, 51,
  79, 80, 81,
  89, 90, 91,
] as const;

const outputDirectory = new URL('./golden-v2/', import.meta.url);
await mkdir(outputDirectory, {recursive: true});
const prepared = prepareRenderPlan(goldenFixtureV2);
for (const frame of GOLDEN_FRAMES) {
  const filename = `frame-${frame.toString().padStart(3, '0')}.json`;
  await writeFile(new URL(filename, outputDirectory), `${JSON.stringify(evaluateFrame(prepared, frame), null, 2)}\n`, 'utf8');
}
console.log(`Updated ${GOLDEN_FRAMES.length} RenderState goldens in ${fileURLToPath(outputDirectory)}`);
