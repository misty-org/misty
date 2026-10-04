import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
const root = import.meta.dirname;
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(root, "../../src") } },
  cacheDir: resolve(root, ".cache/vite"),
  server: {
    host: "127.0.0.1",
    port: 5290,
    strictPort: true,
    fs: { allow: [resolve(root, "../..")] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
