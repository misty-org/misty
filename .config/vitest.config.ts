import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  server: {
    fs: {
      allow: [
        process.cwd(),
        new URL("../../misty-ui", import.meta.url).pathname,
        new URL("../../misty-sdk", import.meta.url).pathname,
      ],
    },
  },
  resolve: {
    // @misty/ui is linked from ../misty-ui as source: its React and icons are this app's own. @misty/sdk is
    // read as source from ../misty-sdk too, with this app's one copy of Yjs.
    // react-resizable-panels (the same version in both) picks a CommonJS build for Node, so it is this app's too.
    dedupe: ["react", "react-dom", "lucide-react", "yjs", "y-protocols", "react-resizable-panels"],
    // misty-ui's own packages run through Vite here (see `server.deps.inline`); their ES builds, so a package with
    // only a CommonJS `main` besides (react-remove-scroll and its kin) doesn't `require` misty-ui's React.
    mainFields: ["module", "jsnext:main", "jsnext", "main"],
    alias: [
      { find: "@", replacement: new URL("../src", import.meta.url).pathname },
      {
        find: /^@misty\/sdk$/,
        replacement: new URL("../../misty-sdk/packages/sdk/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    // ../misty-ui keeps its own node_modules: packages there (Radix and the rest) are run through Vite here, so
    // `dedupe` hands them this app's one React instead of letting Node load misty-ui's copy.
    server: { deps: { inline: [/[\\/]misty-ui[\\/]node_modules[\\/]/] } },
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
