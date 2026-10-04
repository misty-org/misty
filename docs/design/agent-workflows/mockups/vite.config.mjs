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
  cacheDir: resolve(repo, "node_modules/.vite/agent-workflow-mockups"),
  resolve: { alias: { "@": resolve(repo, "src") } },
  server: { host: "127.0.0.1", port: 5207, strictPort: true, fs: { allow: [repo] } },
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: resolve(root, "dist"), emptyOutDir: true },
});
