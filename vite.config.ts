import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import posthog from "@posthog/rollup-plugin";
import { publicSdkDevelopmentUpdates } from "./scripts/vite-public-sdk.mjs";
import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import {
  officialAppDevelopmentPath,
  officialAppCatalogRequiresAssets,
} from "./scripts/official-app-development-paths.mjs";

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

const officialAppsPublicPath = "/official-apps/";
const officialAppsCatalogPath = `${officialAppsPublicPath}catalog.json`;

function officialAppDevelopmentAssets(assetsRoot: string, catalogPath: string): Plugin {
  const normalizedRoot = resolve(assetsRoot);

  return {
    name: "misty-official-app-development-assets",
    configureServer(server) {
      // A package rebuild updates checksums without changing the App version.
      // Reload the host's in-memory catalog so it verifies and activates the
      // new bundle instead of keeping an old package or rejecting its hash.
      server.watcher.add(catalogPath);
      const reloadCatalog = (changedPath: string) => {
        if (resolve(changedPath) === resolve(catalogPath)) {
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("change", reloadCatalog);
      server.httpServer?.once("close", () => server.watcher.off("change", reloadCatalog));
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          next();
          return;
        }
        const requestPath = request.url?.split("?", 1)[0];
        if (requestPath === officialAppsCatalogPath) {
          serveDevelopmentAsset(request.method, response, catalogPath, "application/json");
          return;
        }
        if (!requestPath?.startsWith(officialAppsPublicPath)) {
          next();
          return;
        }

        let relativePath: string;
        try {
          relativePath = decodeURIComponent(requestPath.slice(officialAppsPublicPath.length));
        } catch {
          rejectDevelopmentAsset(response, 400, "Invalid official App asset path.");
          return;
        }
        const assetPath = resolve(normalizedRoot, relativePath);
        if (
          !relativePath ||
          relativePath.split("/").includes("..") ||
          !assetPath.startsWith(`${normalizedRoot}${sep}`)
        ) {
          rejectDevelopmentAsset(response, 404, "Official App asset not found.");
          return;
        }
        serveDevelopmentAsset(request.method, response, assetPath, assetContentType(assetPath));
      });
    },
  };
}

function serveDevelopmentAsset(
  method: string | undefined,
  response: import("node:http").ServerResponse,
  filePath: string,
  contentType: string,
) {
  let size: number;
  try {
    const metadata = statSync(filePath);
    if (!metadata.isFile()) throw new Error("not a file");
    size = metadata.size;
  } catch {
    rejectDevelopmentAsset(response, 404, "Official App asset not found. Build it first.");
    return;
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", size);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function rejectDevelopmentAsset(
  response: import("node:http").ServerResponse,
  status: number,
  message: string,
) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(message);
}

function assetContentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
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
  const officialAppsCatalog = officialAppDevelopmentPath(
    command === "serve" ? env.MISTY_OFFICIAL_APPS_CATALOG : undefined,
    process.cwd(),
    "apps/catalog.json",
  );
  const officialAppsRequireAssets = officialAppCatalogRequiresAssets(officialAppsCatalog);
  const officialAppsRoot = officialAppDevelopmentPath(
    command === "serve" ? env.MISTY_OFFICIAL_APPS_DIR : undefined,
    process.cwd(),
    "public/official-apps",
    // Generated downloads are optional at Host startup. A fresh checkout can
    // still launch before local App packages have been built and signed.
    { allowMissingGeneratedAssets: true },
  );
  const localOfficialAppsAvailable =
    command === "serve" &&
    existsSync(officialAppsCatalog) &&
    (!officialAppsRequireAssets || existsSync(officialAppsRoot));
  if (command === "build" && mode === "web" && !publicApiUrl) {
    throw new Error("Web builds require MISTY_PUBLIC_API_URL to point at the deployed Misty API.");
  }
  const uploadSourceMaps = Boolean(
    command === "build" && sourceMapKey && posthogProjectId && posthogHost && mode !== "test",
  );
  const platformLayoutPath =
    mode === "mobile" || mode === "android"
      ? new URL("./src/application/platform-layout.mobile.tsx", import.meta.url).pathname
      : new URL("./src/application/platform-layout.tsx", import.meta.url).pathname;
  const storePagePath =
    mode === "mobile" || mode === "android"
      ? new URL("./src/application/store-page.mobile.tsx", import.meta.url).pathname
      : new URL("./src/application/store-page.tsx", import.meta.url).pathname;
  return {
    plugins: [
      publicSdkDevelopmentUpdates(),
      react(),
      tailwindcss(),
      materialIconThemeAssets(),
      ...(mode !== "mobile" && mode !== "android"
        ? [
            {
              name: "misty-downloaded-app-host-boundary",
              generateBundle(_options, bundle) {
                const forbidden = Object.values(bundle).flatMap((item) =>
                  item.type === "chunk"
                    ? Object.entries(item.modules)
                        .filter(
                          ([id, details]) =>
                            details.renderedLength > 0 &&
                            /\/(?:TerminalWorkspace(?:View)?|SpaceTasksView|SpaceAgendaView|SpaceRoadmapView)\.tsx$/.test(
                              id,
                            ),
                        )
                        .map(([id]) => id)
                    : [],
                );
                if (forbidden.length)
                  this.error(
                    `Downloaded app screens must not ship inside the desktop Host:\n${forbidden.join("\n")}`,
                  );
              },
            } satisfies Plugin,
          ]
        : []),
      ...(localOfficialAppsAvailable
        ? [officialAppDevelopmentAssets(officialAppsRoot, officialAppsCatalog)]
        : []),
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
      "import.meta.env.VITE_MISTY_LOCAL_OFFICIAL_APPS": JSON.stringify(
        localOfficialAppsAvailable ? "true" : "",
      ),
    },
    clearScreen: false,
    optimizeDeps: {
      // Local SDK snapshots change during development without a version bump.
      // Serve their ESM directly so WebKit cannot retain an older bundled API.
      exclude: ["@misty/sdk", "@misty/contracts"],
    },
    resolve: {
      alias: {
        "@/features/apps/EmbeddedPlanner": new URL(
          mode === "mobile" || mode === "android"
            ? "./src/features/apps/EmbeddedPlanner.mobile.tsx"
            : "./src/features/apps/EmbeddedPlanner.tsx",
          import.meta.url,
        ).pathname,
        "@/application/platform-layout": platformLayoutPath,
        "@/application/store-page": storePagePath,
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
        // Ignore this Host's build output, not the linked public SDK's dist.
        // Ignoring every dist directory leaves SDK exports stale during dev.
        ignored: [resolve(import.meta.dirname, "dist/**"), "**/src-tauri/target/**"],
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
