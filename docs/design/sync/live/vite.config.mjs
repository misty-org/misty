import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
const root = process.cwd();
export default defineConfig({root:resolve(root,'docs/design/sync/live'),plugins:[react(),tailwindcss()],cacheDir:resolve(root,'node_modules/.vite/sync-review'),resolve:{alias:{'@/api/client/session':resolve(root,'docs/design/sync/live/session.ts'),'@':resolve(root,'src')}},server:{host:'127.0.0.1',port:5197,strictPort:true,fs:{allow:[root]}},optimizeDeps:{entries:['index.html']}});
