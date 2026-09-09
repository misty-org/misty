import {
  appSourceAliases,
  appSourceDependencies,
  appSourceRoot,
} from "./scripts/app-source-paths.mjs";
import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const materialIconThemeDir = dirname(
  createRequire(import.meta.url).resolve("material-icon-theme/package.json"),
);

export default defineConfig({
  envDir: false,
  server: { fs: { allow: [process.cwd(), appSourceRoot(process.cwd())] } },
  plugins: [appSourceDependencies(process.cwd())],
  resolve: {
    dedupe: ["react", "react-dom", "@misty/sdk", "@misty/contracts"],
    alias: {
      ...appSourceAliases(process.cwd()),
      "@misty/browser-view": `${appSourceRoot(process.cwd())}/apps/browser/workspace/SDKBrowserView.tsx`,
      "@": new URL("./src", import.meta.url).pathname,
      "#material-icon-theme": materialIconThemeDir,
    },
  },
  test: {
    server: { deps: { inline: [/misty-apps\/apps\//] } },
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      `${appSourceRoot(process.cwd())}/apps/{journal,planner,library,agents,files,browser,code,terminal,chat,inbox,shared}/**/*.test.{ts,tsx}`,
    ],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
