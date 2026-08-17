import { defineConfig } from "vitest/config";

// Live acceptance runs: real models, the local dev server and a headless
// browser. Opt in with MISTY_ACCEPTANCE=1 (npm run acceptance does).
export default defineConfig({
  envDir: false,
  resolve: {
    alias: {
      "@": new URL("../src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.acceptance.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
