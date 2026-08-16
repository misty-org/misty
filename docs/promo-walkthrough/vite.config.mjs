import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Isolated film project: borrows the app's stylesheet, shared UI and assets
// through the "@" alias, and never imports app stores or native bridges.
const root = import.meta.dirname;
const repo = resolve(root, "../..");
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(repo, "src") } },
  cacheDir: resolve(root, ".cache/vite"),
  server: { host: "127.0.0.1", port: 5292, strictPort: true, fs: { allow: [repo] } },
  build: { outDir: "dist", emptyOutDir: true },
});
