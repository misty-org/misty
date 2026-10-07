import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  server: { fs: { allow: [process.cwd()] } },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": new URL("../src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    // Each UI worker loads the application graph and a full DOM. Bound contention
    // so real interaction tests retain their normal timeouts in the full suite.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
    // The heaviest UI tests take about 2s alone. Hooks run on a shared machine
    // where other apps and sessions compete for the CPU, and Vitest's 5s default
    // failed a different one of them on most busy runs.
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
