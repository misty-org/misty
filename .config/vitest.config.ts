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
    // Most of the suite's time is per-file setup (a fresh DOM and module graph),
    // which threads start faster than forked processes. The git hooks run the
    // other suites alongside this one and set MISTY_SHARED_CPU, so it takes
    // half the cores there; lazily loaded views then keep their timeouts.
    pool: "threads",
    maxWorkers: process.env.MISTY_SHARED_CPU
      ? Math.max(1, Math.floor(availableParallelism() / 2))
      : Math.max(1, Math.min(10, availableParallelism() - 3)),
    // The heaviest UI tests take about 2s alone. Hooks run on a shared machine
    // where other apps and sessions compete for the CPU, and Vitest's 5s default
    // failed a different one of them on most busy runs.
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
