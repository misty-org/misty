import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "../../../..");
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  cacheDir: resolve(repo, "node_modules/.vite/spaces-chat-prototype"),
  resolve: { alias: { "@": resolve(repo, "src") } },
  server: { host: "127.0.0.1", port: 5217, strictPort: true, fs: { allow: [repo] } },
  optimizeDeps: { entries: ["index.html"] },
  build: {
    outDir: resolve(repo, "node_modules/.cache/spaces-chat-preview"),
    rollupOptions: {
      input: {
        prototype: resolve(root, "index.html"),
        gallery: resolve(root, "gallery.html"),
        production: resolve(root, "production.html"),
      },
    },
  },
});
