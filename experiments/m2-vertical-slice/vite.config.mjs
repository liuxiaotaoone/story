import {createReadStream, existsSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {defineConfig} from 'vite';

const root = import.meta.dirname;
const assetRoot = resolve(root, '..', 'asset-feasibility');
const contentTypes = {'.png': 'image/png', '.wav': 'audio/wav', '.json': 'application/json'};

export default defineConfig({
  publicDir: resolve(root, 'generated'),
  plugins: [{
    name: 'm2-asset-source',
    configureServer(server) {
      server.middlewares.use('/asset-source/', (request, response) => {
        const relative = decodeURIComponent((request.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        const target = resolve(assetRoot, relative);
        if (!target.startsWith(`${assetRoot}\\`) || !existsSync(target)) {
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
