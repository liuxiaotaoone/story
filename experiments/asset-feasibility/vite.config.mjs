import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {defineConfig} from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'anchor-review-api',
    configureServer(server) {
      server.middlewares.use('/api/anchors', (request, response, next) => {
        if (request.method !== 'POST') return next();
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => { body += chunk; });
        request.on('end', async () => {
          try {
            const metadata = JSON.parse(body);
            const file = String(metadata.file ?? '');
            if (!/^(processed|normalized)\/[a-z0-9-]+\/[a-z0-9-]+\.png$/i.test(file)) throw new Error('Invalid asset file path');
            const relative = file.replace(/^(processed|normalized)\//, '').replace(/\.png$/i, '.json');
            const target = resolve(root, 'anchors', relative);
            const anchorsRoot = resolve(root, 'anchors');
            if (!target.startsWith(`${anchorsRoot}\\`) && !target.startsWith(`${anchorsRoot}/`)) throw new Error('Anchor path escapes workspace');
            metadata.reviewStatus = 'approved';
            await mkdir(resolve(target, '..'), {recursive: true});
            await writeFile(target, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({saved: relative, reviewStatus: 'approved'}));
          } catch (error) {
            response.statusCode = 400;
            response.end(error instanceof Error ? error.message : String(error));
          }
        });
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        tools: resolve(root, 'index.html'),
        demo: resolve(root, 'demo.html'),
      },
    },
  },
});
