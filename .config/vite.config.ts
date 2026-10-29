import { loadAppEnv, publicAppEnv, appEnvironmentUpdates } from "../cli/tasks/app-env.ts";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import posthog from "@posthog/rollup-plugin";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nodeShims: Record<string, string> = {
  fs: "fs",
  "fs/promises": "fsPromises",
  path: "path",
  os: "os",
  util: "util",
  crypto: "crypto",
  buffer: "buffer",
  assert: "other",
  async_hooks: "other",
  child_process: "other",
  net: "other",
  string_decoder: "other",
};

export default defineConfig(({ command, mode }) => {
  const env = loadAppEnv(process.cwd());
  if (
    !["desktop", "development", "production", "test"].includes(mode) ||
    (env.VITE_MISTY_TARGET?.trim() && env.VITE_MISTY_TARGET.trim().toLowerCase() !== "desktop")
  ) {
    throw new Error(
      "Misty only supports the desktop app target. Use misty desktop dev or npm run build:desktop.",
    );
  }
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
  // The server's website is named per build; a release that names none links to no website.
  const defaultPublicUrl = isDev ? "http://localhost:5174" : "";
  const publicUrl = (env.MISTY_PUBLIC_URL ?? env.VITE_MISTY_PUBLIC_URL)?.trim() || defaultPublicUrl;
  const uploadSourceMaps = Boolean(
    command === "build" && sourceMapKey && posthogProjectId && posthogHost && mode !== "test",
  );

  return {
    root: resolve(process.cwd(), "src/app"),
    publicDir: false,
    envDir: false,
    plugins: [
      appEnvironmentUpdates(process.cwd()),
      react(),
      tailwindcss(),
      ...(uploadSourceMaps
        ? [
            posthog({
              personalApiKey: sourceMapKey!,
              projectId: posthogProjectId,
              host: posthogHost,
              sourcemaps: {
                enabled: true,
                releaseName: "misty-desktop",
                releaseVersion: process.env.MISTY_RELEASE_VERSION ?? "0.1.0",
                deleteAfterUpload: true,
              },
            }),
          ]
        : []),
    ],
    define: {
      "import.meta.env.MISTY_SHELL_MACOS": JSON.stringify(
        ["darwin", "macos"].includes(process.env.TAURI_ENV_PLATFORM || process.platform),
      ),
      "import.meta.env.MISTY_NATIVE_MACOS_CAPTURE": JSON.stringify(
        ["darwin", "macos"].includes(process.env.TAURI_ENV_PLATFORM || process.platform),
      ),
      ...publicAppEnv(env),
      "import.meta.env.VITE_POSTHOG_PROJECT_TOKEN": JSON.stringify(posthogToken ?? ""),
      "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(posthogHost ?? ""),
      // MISTY_PUBLIC_API_URL is the shared server/frontend deployment contract.
      // Vite's internal alias keeps non-VITE server secrets out of the bundle.
      "import.meta.env.VITE_MISTY_PUBLIC_API_URL": JSON.stringify(publicApiUrl ?? ""),
      "import.meta.env.VITE_MISTY_PUBLIC_URL": JSON.stringify(publicUrl ?? ""),
    },
    clearScreen: false,
    // Keep each app runtime separate from other Vite servers and temporary previews.
    // Sharing optimized dependencies can invalidate imports in an already-open webview.
    cacheDir: resolve(
      process.cwd(),
      "node_modules/.vite",
      command === "serve" ? `misty-${mode}-${desktopDevPort}` : `misty-${mode}`,
    ),
    optimizeDeps: {
      // Scan the real app (including its lazy imports), not standalone HTML
      // probes in cli/tasks/. A probe-only unresolved import aborts Vite's scan;
      // opening Explorer then discovers dependencies late and reloads the host.
      entries: ["index.html"],
      // Photon (Midscene's screenshot resizer) loads its .wasm next to its own
      // module; pre-bundling moves the module and the file is no longer found.
      exclude: ["@silvia-odwyer/photon"],
    },
    resolve: {
      alias: [
        { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
        // Midscene's planner runs in the app; its Node-only helpers get browser stubs.
        ...Object.entries(nodeShims).map(([name, file]) => ({
          find: new RegExp(`^node:${name}$`),
          replacement: fileURLToPath(
            new URL(`../src/shared/platform/nodeShims/${file}.ts`, import.meta.url),
          ),
        })),
        {
          find: /^sharp$/,
          replacement: fileURLToPath(
            new URL("../src/shared/platform/nodeShims/sharp.ts", import.meta.url),
          ),
        },
      ],
    },
    build: {
      outDir: resolve(process.cwd(), "dist"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), "src/app/index.html"),
          companion: resolve(process.cwd(), "src/app/companion.html"),
          desktop: resolve(process.cwd(), "src/app/desktop.html"),
        },
      },
      assetsInlineLimit: 0,
      sourcemap: uploadSourceMaps ? "hidden" : false,
    },
    server: {
      fs: {
        allow: [process.cwd()],
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
        // Backend tsconfigs and generated review HTML are outside the frontend
        // graph. Watching them makes Vite reload every open development app.
        ignored: [
          resolve(import.meta.dirname, "../dist/**"),
          "**/src-tauri/target/**",
          resolve(import.meta.dirname, "../server/**"),
          resolve(import.meta.dirname, "../.impeccable/**"),
        ],
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
