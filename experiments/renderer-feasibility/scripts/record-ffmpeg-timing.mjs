import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const [reportArgument, millisecondsArgument] = process.argv.slice(2);
if (reportArgument === undefined || millisecondsArgument === undefined) {
  throw new Error('Usage: node record-ffmpeg-timing.mjs <report.json> <encodeMs>');
}
const encodeMs = Number(millisecondsArgument);
if (!Number.isFinite(encodeMs) || encodeMs < 0) throw new Error(`Invalid encodeMs: ${millisecondsArgument}`);

const reportPath = resolve(reportArgument);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const pipelineElapsedMs = report.total.pipelineElapsedMs ?? report.total.elapsedMs;
report.ffmpeg.encodeMs = encodeMs;
report.total.pipelineElapsedMs = pipelineElapsedMs;
report.total.elapsedMs = pipelineElapsedMs + encodeMs;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
