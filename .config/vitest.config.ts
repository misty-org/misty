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
    maxWorkers: 4,
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
