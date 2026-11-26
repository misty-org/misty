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
    dedupe: ["react", "react-dom", "lucide-react", "yjs", "y-protocols", "react-resizable-panels"],
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
    server: { deps: { inline: [/[\\/]misty-ui[\\/]node_modules[\\/]/] } },
    environment: "jsdom",
    pool: "threads",
    execArgv: ["--no-experimental-webstorage"],
    maxWorkers: process.env.MISTY_SHARED_CPU
      ? Math.max(1, Math.floor(availableParallelism() / 2))
      : Math.max(1, Math.min(10, availableParallelism() - 3)),
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
