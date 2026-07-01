import {
  appSourceAliases,
  appSourceDependencies,
  appSourceRoot,
} from "./cli/tasks/app-source-paths.ts";
import { loadAppEnv, publicAppEnv, appEnvironmentUpdates } from "./cli/tasks/app-env.ts";
import { localAppsDirectory } from "./cli/tasks/local-apps-directory.ts";
import { createDesktopAppPreparation } from "./cli/tasks/prepare-desktop-apps.ts";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import posthog from "@posthog/rollup-plugin";
import { publicSdkDevelopmentUpdates } from "./cli/tasks/vite-public-sdk.ts";
import { materialIconProjection, copyMaterialIcons } from "./cli/tasks/material-icon-assets.ts";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import {
  officialAppDevelopmentPath,
  officialAppCatalogRequiresAssets,
} from "./cli/tasks/official-app-development-paths.ts";

// Resolve through Node so the static icon copy works wherever npm hoists the
// package.
const materialIconThemeDir = dirname(
  createRequire(import.meta.url).resolve("material-icon-theme/package.json"),
);
const materialIconThemeIconsDir = join(materialIconThemeDir, "icons");
const materialIconThemePublicPath = "/assets/material-icon-theme/";

// Keep SVGs outside Rollup's module graph. Copy only assets referenced by
// Misty's file/folder associations; editor-specific theme variants stay out.
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
      copyMaterialIcons(join(outputDir, resolvedConfig.build.assetsDir, "material-icon-theme"));
    },
  };
}

const officialAppsPublicPath = "/official-apps/";
const officialAppsCatalogPath = `${officialAppsPublicPath}catalog.json`;

function officialAppDevelopmentAssets(
  assetsRoot: string,
  catalogPath: string,
  appsDirectory = "",
): Plugin {
  const normalizedRoot = resolve(assetsRoot);

  return {
    name: "misty-official-app-development-assets",
    configureServer(server) {
      const prepareApp = appsDirectory
        ? createDesktopAppPreparation(server.config.root, {
            ...process.env,
            VITE_MISTY_APPS_DIRECTORY: appsDirectory,
          })
        : undefined;
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
          if (appsDirectory) {
            const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
            for (const app of catalog.apps) {
              if (app.desktop?.runtime === "downloaded" && /^[a-z0-9_-]+$/.test(app.id)) {
                app.desktop.entry = `/__misty-local-apps/${app.id}/desktop/app.js`;
              }
            }
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-store");
            response.end(request.method === "HEAD" ? undefined : JSON.stringify(catalog));
            return;
          }
          serveDevelopmentAsset(request.method, response, catalogPath, "application/json");
          return;
        }
        if (appsDirectory && requestPath?.startsWith("/__misty-local-apps/")) {
          let relative: string;
          try {
            relative = decodeURIComponent(requestPath.slice("/__misty-local-apps/".length));
          } catch {
            rejectDevelopmentAsset(response, 400, "Invalid local app asset path.");
            return;
          }
          const root = resolve(appsDirectory, ".build/official-apps");
          const file = resolve(root, relative);
          if (!file.startsWith(`${root}${sep}`) || relative.split("/").includes("..")) {
            rejectDevelopmentAsset(response, 404, "Local app asset not found.");
            return;
          }
          void prepareApp!(relative.split("/")[0])
            .then((available: boolean) => {
              if (response.destroyed) return;
              try {
                if (!available || !realpathSync(file).startsWith(`${realpathSync(root)}${sep}`))
                  throw new Error("Outside local build");
              } catch {
                rejectDevelopmentAsset(response, 404, "Local app asset not found.");
                return;
              }
              serveDevelopmentAsset(request.method, response, file, assetContentType(file));
            })
            .catch((error: Error) => {
              server.config.logger.error(`Local app preparation failed: ${error.message}`);
              if (!response.destroyed)
                rejectDevelopmentAsset(
                  response,
                  503,
                  "Local app build failed. Fix the build error and reload to retry.",
                );
            });
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

export default defineConfig(({ command, mode }) => {
  const env = loadAppEnv(process.cwd());
  const tauriDevHost = env.TAURI_DEV_HOST;
  const desktopDevPort = Number(env.MISTY_DESKTOP_DEV_PORT ?? 5173);
  const accountApiProxyTarget = env.MISTY_ACCOUNT_API_PROXY_TARGET?.trim();
  const posthogToken = env.POSTHOG_PROJECT_TOKEN?.trim();
  const posthogHost = env.POSTHOG_HOST?.trim();
  const posthogProjectId = env.POSTHOG_PROJECT_ID?.trim();
  const sourceMapKey = env.POSTHOG_API_KEY?.trim();
  const publicApiUrl = (env.MISTY_PUBLIC_API_URL ?? env.VITE_MISTY_PUBLIC_API_URL)?.trim();
  const isDev =
    command === "serve" || mode.includes("dev") || process.env.NODE_ENV !== "production";
  const defaultPublicUrl = isDev ? "http://localhost:5174" : "https://mistysys.com";
  const publicUrl = (env.MISTY_PUBLIC_URL ?? env.VITE_MISTY_PUBLIC_URL)?.trim() || defaultPublicUrl;
  const appsDirectory =
    command === "serve" && mode === "desktop"
      ? localAppsDirectory(env.VITE_MISTY_APPS_DIRECTORY ?? env.MISTY_APPS_DIRECTORY, process.cwd())
      : "";
  const localOfficialAppsEnabled = command === "serve" && (mode !== "desktop" || !!appsDirectory);
  const officialAppsCatalog = officialAppDevelopmentPath(
    appsDirectory
      ? resolve(appsDirectory, "catalog.json")
      : localOfficialAppsEnabled
        ? env.MISTY_OFFICIAL_APPS_CATALOG
        : undefined,
    process.cwd(),
    "catalog.json",
  );
  const officialAppsRequireAssets =
    !appsDirectory &&
    localOfficialAppsEnabled &&
    officialAppCatalogRequiresAssets(officialAppsCatalog);
  const officialAppsRoot = appsDirectory
    ? resolve(appsDirectory, "public/official-apps")
    : officialAppDevelopmentPath(
        localOfficialAppsEnabled ? env.MISTY_OFFICIAL_APPS_DIR : undefined,
        process.cwd(),
        "public/official-apps",
        // Generated downloads are optional at Host startup. A fresh checkout can
        // still launch before local App packages have been built and signed.
        { allowMissingGeneratedAssets: true },
      );
  const localOfficialAppsAvailable =
    localOfficialAppsEnabled &&
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

  return {
    envDir: false,
    plugins: [
      appEnvironmentUpdates(process.cwd()),
      appSourceDependencies(process.cwd()),
      publicSdkDevelopmentUpdates(),
      react(),
      tailwindcss(),
      ...(mode === "mobile" || mode === "android" ? [materialIconThemeAssets()] : []),
      materialIconProjection(),
      ...(mode !== "mobile" && mode !== "android"
        ? [
            {
              name: "misty-native-preview-adapters",
              enforce: "pre",
              resolveId(source, importer) {
                if (
                  mode === "desktop" &&
                  ["darwin", "macos"].includes(
                    process.env.TAURI_ENV_PLATFORM || process.platform,
                  ) &&
                  /(?:^|\/)FilePicker(?:\.tsx)?$/.test(source)
                )
                  return resolve(process.cwd(), "src/features/picker/HostFilePicker.tsx");
                if (/(?:^|\/)FileBrowserIcons(?:\.tsx)?$/.test(source))
                  return resolve(process.cwd(), "src/features/apps/HostFileIcons.tsx");
                if (/(?:^|\/)PhotoEditorView(?:\.tsx)?$/.test(source))
                  return resolve(process.cwd(), "src/features/apps/FilePhotoEditor.tsx");
                if (
                  importer?.includes("/apps/files/workspace/") &&
                  /(?:^|\/)VideoAnnotator(?:\.tsx)?$/.test(source)
                )
                  return resolve(process.cwd(), "src/features/apps/FileVideoPreview.tsx");
                if (
                  importer?.includes("/apps/files/workspace/") &&
                  /(?:^|\/)PdfViewerView(?:\.tsx)?$/.test(source)
                )
                  return resolve(process.cwd(), "src/features/apps/FilePdfPreview.tsx");
              },
            } satisfies Plugin,
          ]
        : []),
      ...(localOfficialAppsAvailable
        ? [officialAppDevelopmentAssets(officialAppsRoot, officialAppsCatalog, appsDirectory)]
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
      "import.meta.env.MISTY_SHELL_MACOS": JSON.stringify(
        mode === "desktop" &&
          ["darwin", "macos"].includes(process.env.TAURI_ENV_PLATFORM || process.platform),
      ),
      "import.meta.env.MISTY_NATIVE_MACOS_CAPTURE": JSON.stringify(
        mode === "desktop" &&
          ["darwin", "macos"].includes(process.env.TAURI_ENV_PLATFORM || process.platform),
      ),
      ...publicAppEnv(env),
      "import.meta.env.VITE_POSTHOG_PROJECT_TOKEN": JSON.stringify(posthogToken ?? ""),
      "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(posthogHost ?? ""),
      // MISTY_PUBLIC_API_URL is the shared server/frontend deployment contract.
      // Vite's internal alias keeps non-VITE server secrets out of the bundle.
      "import.meta.env.VITE_MISTY_PUBLIC_API_URL": JSON.stringify(publicApiUrl ?? ""),
      "import.meta.env.VITE_MISTY_PUBLIC_URL": JSON.stringify(publicUrl ?? ""),
      "import.meta.env.VITE_MISTY_APPS_DIRECTORY": JSON.stringify(
        appsDirectory || (localOfficialAppsAvailable ? dirname(dirname(officialAppsCatalog)) : ""),
      ),
    },
    clearScreen: false,
    // Keep each app runtime separate from other Vite servers and temporary previews.
    // Sharing optimized dependencies can invalidate imports in an already-open webview.
    cacheDir: resolve(process.cwd(), "node_modules/.vite", `misty-${mode}`),
    optimizeDeps: {
      // Scan the real app (including its lazy imports), not standalone HTML
      // probes in cli/tasks/. A probe-only unresolved import aborts Vite's scan;
      // opening Explorer then discovers dependencies late and reloads the host.
      entries: ["index.html"],
      // Local SDK snapshots change during development without a version bump.
      // Serve their ESM directly so WebKit cannot retain an older bundled API.
      exclude: ["@misty/sdk", "@misty/contracts"],
      // The public contracts own Zod 4; host modules still use Zod 3. Preserve
      // this nested dependency when serving excluded SDK modules directly.
      include: ["@misty/contracts > zod"],
    },
    resolve: {
      alias: {
        ...appSourceAliases(process.cwd()),
        "@misty/browser-view": resolve(
          appSourceRoot(process.cwd()),
          "browser/workspace/SDKBrowserView.tsx",
        ),
        "@/application/platform-layout": platformLayoutPath,
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
    build: {
      assetsInlineLimit: 0,
      sourcemap: uploadSourceMaps ? "hidden" : false,
    },
    server: {
      fs: {
        allow: [process.cwd(), appSourceRoot(process.cwd()), resolve(process.cwd(), ".")],
      },
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
