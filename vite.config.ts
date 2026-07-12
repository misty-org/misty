import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import posthog from "@posthog/rollup-plugin";

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
  const uploadSourceMaps = Boolean(
    command === "build" &&
      sourceMapKey &&
      posthogProjectId &&
      posthogHost &&
      mode !== "test",
  );

  return {
    plugins: [
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
                releaseVersion:
                  process.env.GITHUB_SHA ??
                  process.env.MISTY_RELEASE_VERSION ??
                  "0.1.0",
                deleteAfterUpload: true,
              },
            }),
          ]
        : []),
    ],
    define: {
      "import.meta.env.VITE_POSTHOG_PROJECT_TOKEN": JSON.stringify(
        posthogToken ?? "",
      ),
      "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(posthogHost ?? ""),
    },
    clearScreen: false,
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
