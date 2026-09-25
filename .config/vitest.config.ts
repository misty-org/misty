import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  server: { fs: { allow: [process.cwd()] } },
  resolve: {
    dedupe: ["react", "react-dom", "@misty/sdk", "@misty/contracts"],
    alias: {
      "@misty/browser-view": new URL(
        "../src/features/browser/workspace/SDKBrowserView.tsx",
        import.meta.url,
      ).pathname,
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
