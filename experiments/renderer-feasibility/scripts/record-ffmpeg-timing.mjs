import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizeBenchmarkReport} from './benchmark-report.mjs';

const [reportArgument, millisecondsArgument] = process.argv.slice(2);
if (reportArgument === undefined || millisecondsArgument === undefined) {
  throw new Error('Usage: node record-ffmpeg-timing.mjs <report.json> <encodeMs>');
}
const reportPath = resolve(reportArgument);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
await writeFile(reportPath, `${JSON.stringify(normalizeBenchmarkReport(report, Number(millisecondsArgument)), null, 2)}\n`);
