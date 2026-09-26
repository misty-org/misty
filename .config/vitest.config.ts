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
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
