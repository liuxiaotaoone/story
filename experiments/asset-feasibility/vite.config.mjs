import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        tools: resolve(root, 'index.html'),
        demo: resolve(root, 'demo.html'),
      },
    },
  },
});
