import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import posthog from "@posthog/rollup-plugin";
import { cpSync, createReadStream, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";

// Resolve through Node so the static icon copy works wherever npm hoists the
// package.
const materialIconThemeDir = dirname(
  createRequire(import.meta.url).resolve("material-icon-theme/package.json"),
);
const materialIconThemeIconsDir = join(materialIconThemeDir, "icons");
const materialIconThemePublicPath = "/assets/material-icon-theme/";

// These SVGs are static runtime assets, not JavaScript modules. Keeping all
// 1,250 icons out of Rollup's module graph substantially lowers peak build
// memory while preserving the full Material Icon Theme lookup table.
function materialIconThemeAssets(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: "misty-material-icon-theme-assets",
    configResolved(config) {
      resolvedConfig = config;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = request.url?.split("?", 1)[0];
        if (!requestPath?.startsWith(materialIconThemePublicPath)) {
          next();
          return;
        }

        let fileName: string;
        try {
          fileName = decodeURIComponent(requestPath.slice(materialIconThemePublicPath.length));
        } catch {
          next();
          return;
        }
        if (fileName !== basename(fileName) || extname(fileName) !== ".svg") {
          next();
          return;
        }

        const iconPath = join(materialIconThemeIconsDir, fileName);
        if (!existsSync(iconPath)) {
          next();
          return;
        }

        response.setHeader("Content-Type", "image/svg+xml");
        response.setHeader("Cache-Control", "public, max-age=86400");
        createReadStream(iconPath).pipe(response);
      });
    },
    writeBundle(outputOptions) {
      const outputDir = outputOptions.dir
        ? resolve(outputOptions.dir)
        : resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      cpSync(
        materialIconThemeIconsDir,
        join(outputDir, resolvedConfig.build.assetsDir, "material-icon-theme"),
        { recursive: true },
      );
    },
  };
}

const tauriDevHost = process.env.TAURI_DEV_HOST;
const desktopDevPort = Number(process.env.MISTY_DESKTOP_DEV_PORT ?? 5173);
const accountApiProxyTarget = process.env.MISTY_ACCOUNT_API_PROXY_TARGET?.trim();

export default defineConfig(({ command, mode }) => {
  const modeEnv = loadEnv(mode, process.cwd(), "");
  const analyticsEnv = loadEnv("analytics", process.cwd(), "");
  const env = { ...analyticsEnv, ...modeEnv, ...process.env };
  const posthogToken = env.POSTHOG_PROJECT_TOKEN?.trim();
  const posthogHost = env.POSTHOG_HOST?.trim();
  const posthogProjectId = env.POSTHOG_PROJECT_ID?.trim();
  const sourceMapKey = env.POSTHOG_API_KEY?.trim();
  const publicApiUrl = (env.MISTY_PUBLIC_API_URL ?? env.VITE_MISTY_PUBLIC_API_URL)?.trim();
  const publicUrl = (env.MISTY_PUBLIC_URL ?? env.VITE_MISTY_PUBLIC_URL)?.trim();
  if (command === "build" && mode === "web" && !publicApiUrl) {
    throw new Error("Web builds require MISTY_PUBLIC_API_URL to point at the deployed Misty API.");
  }
  const uploadSourceMaps = Boolean(
    command === "build" && sourceMapKey && posthogProjectId && posthogHost && mode !== "test",
  );

  return {
    plugins: [
      react(),
      tailwindcss(),
      materialIconThemeAssets(),
      ...(uploadSourceMaps
        ? [
            posthog({
              personalApiKey: sourceMapKey!,
              projectId: posthogProjectId,
              host: posthogHost,
              sourcemaps: {
                enabled: true,
                releaseName: "misty-desktop",
                releaseVersion:
                  process.env.GITHUB_SHA ?? process.env.MISTY_RELEASE_VERSION ?? "0.1.0",
                deleteAfterUpload: true,
              },
            }),
          ]
        : []),
    ],
    define: {
      "import.meta.env.VITE_POSTHOG_PROJECT_TOKEN": JSON.stringify(posthogToken ?? ""),
      "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(posthogHost ?? ""),
      // MISTY_PUBLIC_API_URL is the shared server/frontend deployment contract.
      // Vite's internal alias keeps non-VITE server secrets out of the bundle.
      "import.meta.env.VITE_MISTY_PUBLIC_API_URL": JSON.stringify(publicApiUrl ?? ""),
      "import.meta.env.VITE_MISTY_PUBLIC_URL": JSON.stringify(publicUrl ?? ""),
    },
    clearScreen: false,
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
    build: {
      assetsInlineLimit: 0,
      sourcemap: uploadSourceMaps ? "hidden" : false,
    },
    server: {
      host: tauriDevHost ?? "127.0.0.1",
      port: desktopDevPort,
      strictPort: true,
      proxy: accountApiProxyTarget
        ? {
            "/api": {
              target: accountApiProxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
      watch: {
        ignored: ["**/dist/**", "**/src-tauri/target/**"],
      },
      hmr: tauriDevHost
        ? {
            protocol: "ws",
            host: tauriDevHost,
            port: desktopDevPort,
          }
        : undefined,
    },
  };
});
