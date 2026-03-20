import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@website": path.resolve(__dirname, "src/features/hub/website"),
    },
  },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
