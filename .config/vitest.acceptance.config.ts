import { defineConfig } from "vitest/config";

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
