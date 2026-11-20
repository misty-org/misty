import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The bundle's files are served by Misty under misty-app://localhost/calendar/<version>/, so every URL in
// the page is relative. Its output is the app's folder: `misty-app.json`, `logo.svg` and what the build makes.
export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: "public",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: false },
});
