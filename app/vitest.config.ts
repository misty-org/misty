import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const materialIconThemeDir = dirname(
  createRequire(import.meta.url).resolve("material-icon-theme/package.json"),
);

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "#material-icon-theme": materialIconThemeDir,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
