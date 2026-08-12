import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

const root = resolve(import.meta.dirname, '..');
const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const executablePath = candidates.find(candidate => existsSync(candidate));
if (!executablePath) throw new Error('Chrome/Edge executable not found');

const server = await createServer({root, server: {host: '127.0.0.1', port: 4175, strictPort: true}, logLevel: 'warn'});
await server.listen();
const browser = await chromium.launch({executablePath, headless: true});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4175/', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => {
    const value = document.querySelector('#anchor-json')?.textContent;
    if (!value) return false;
    const data = JSON.parse(value);
    return data.reviewStatus !== 'loading' && data.anchors?.foot && data.anchors?.center;
  });
  const result = await page.locator('#anchor-json').textContent();
  const metadata = JSON.parse(result ?? '{}');
  process.stdout.write(`${JSON.stringify({assetId: metadata.assetId, reviewStatus: metadata.reviewStatus, anchorCount: Object.keys(metadata.anchors ?? {}).length})}\n`);
} finally {
  await browser.close();
  await server.close();
}
