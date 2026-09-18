import {
  appSourceAliases,
  appSourceDependencies,
  appSourceRoot,
} from "./cli/tasks/app-source-paths.ts";
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
      "@misty/browser-view": `${appSourceRoot(process.cwd())}/browser/workspace/SDKBrowserView.tsx`,
      "@": new URL("./src", import.meta.url).pathname,
      "#material-icon-theme": materialIconThemeDir,
    },
  },
  test: {
    server: { deps: { inline: [/\/apps\//] } },
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "cli/tasks/apps/{package-optional-assets,preserve-app-assets}.test.ts",
      `${appSourceRoot(process.cwd())}/{journal,planner,library,agents,files,browser,code,terminal,chat,inbox,music,media,shared}/**/*.test.{ts,tsx}`,
    ],
    restoreMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
