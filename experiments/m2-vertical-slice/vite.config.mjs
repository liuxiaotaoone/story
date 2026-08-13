import {createReadStream, existsSync} from 'node:fs';
import {extname, isAbsolute, relative, resolve} from 'node:path';
import {defineConfig} from 'vite';

const root = import.meta.dirname;
const assetRoot = resolve(root, '..', 'asset-feasibility');
const contentTypes = {'.png': 'image/png', '.wav': 'audio/wav', '.json': 'application/json'};

export function isPathInsideRoot(rootPath, targetPath) {
  const relativeTarget = relative(rootPath, targetPath);
  return !relativeTarget.startsWith('..') && !isAbsolute(relativeTarget);
}

export default defineConfig({
  publicDir: resolve(root, 'generated'),
  plugins: [{
    name: 'm2-asset-source',
    configureServer(server) {
      server.middlewares.use('/asset-source/', (request, response) => {
        const assetPath = decodeURIComponent((request.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        const target = resolve(assetRoot, assetPath);
        if (!isPathInsideRoot(assetRoot, target) || !existsSync(target)) {
          response.statusCode = 404;
          response.end('Asset not found');
          return;
        }
        response.setHeader('content-type', contentTypes[extname(target)] ?? 'application/octet-stream');
        createReadStream(target).pipe(response);
      });
    },
  }],
});
