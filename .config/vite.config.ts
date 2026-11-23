import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverDeadPages } from "../tasks/dead_page_watchdog.ts";
import { whenStranded } from "../tasks/stranded.ts";

const nodeShims: Record<string, string> = {
  fs: "fs",
  "fs/promises": "fs_promises",
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

function publicAppEnv(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.startsWith("VITE_") && value !== undefined)
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );
}

function stopWhenStranded(): Plugin {
  const watch = (server: { close(): Promise<void> }) =>
    whenStranded(() => {
      void server.close().finally(() => process.exit(1));
      setTimeout(() => process.exit(1), 5_000).unref();
    });
  return {
    name: "misty-stop-when-stranded",
    configureServer: watch,
    configurePreviewServer: watch,
  };
}

function stripAssetSourceMaps(): Plugin {
  return {
    name: "misty-strip-asset-source-maps",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !/\.m?js$/.test(file.fileName)) continue;
        const source =
          typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
        const stripped = source.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n");
        if (stripped !== source) file.source = stripped;
      }
    },
  };
}

function katexWoff2Only(): Plugin {
  return {
    name: "misty-katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(?:\.min)?\.css(?:$|\?)/.test(id)) return;
      return code.replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, "");
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = process.env;
  if (
    !["desktop", "development", "production", "test"].includes(mode) ||
    (env.VITE_MISTY_TARGET?.trim() && env.VITE_MISTY_TARGET.trim().toLowerCase() !== "desktop")
  ) {
    throw new Error(
      "Misty only supports the desktop app target. Use npm run tauri dev or npm run build.",
    );
  }
  const tauriDevHost = env.TAURI_DEV_HOST;
  const desktopDevPort = Number(env.MISTY_DESKTOP_DEV_PORT ?? 5173);
  const frozen = env.MISTY_DEV_FROZEN === "1";
  const accountApiProxyTarget = env.MISTY_ACCOUNT_API_PROXY_TARGET?.trim();
  const publicApiUrl = (env.MISTY_PUBLIC_API_URL ?? env.VITE_MISTY_PUBLIC_API_URL)?.trim();
  const isDev =
    command === "serve" || mode.includes("dev") || process.env.NODE_ENV !== "production";
  const defaultPublicUrl = isDev ? "http://localhost:5174" : "";
  const publicUrl = (env.MISTY_PUBLIC_URL ?? env.VITE_MISTY_PUBLIC_URL)?.trim() || defaultPublicUrl;

  return {
    root: resolve(process.cwd(), "src/app"),
    publicDir: false,
    envDir: false,
    plugins: [
      katexWoff2Only(),
      react(),
      tailwindcss(),
      stripAssetSourceMaps(),
      stopWhenStranded(),
      recoverDeadPages(),
    ],
    define: {
      "import.meta.env.MISTY_SHELL_MACOS": JSON.stringify(
        ["darwin", "macos"].includes(process.env.TAURI_ENV_PLATFORM || process.platform),
      ),
      ...publicAppEnv(env),
      "import.meta.env.VITE_MISTY_PUBLIC_API_URL": JSON.stringify(publicApiUrl ?? ""),
      "import.meta.env.VITE_MISTY_PUBLIC_URL": JSON.stringify(publicUrl ?? ""),
    },
    clearScreen: false,
    cacheDir: resolve(
      process.cwd(),
      "node_modules/.vite",
      command === "serve" ? `misty-${mode}-${desktopDevPort}` : `misty-${mode}`,
    ),
    optimizeDeps: {
      entries: ["index.html"],
      exclude: ["@silvia-odwyer/photon", "@misty/ui"],
    },
    resolve: {
      dedupe: ["react", "react-dom", "lucide-react", "yjs", "y-protocols"],
      alias: [
        { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
        {
          find: /^@misty\/sdk$/,
          replacement: fileURLToPath(
            new URL("../../misty-sdk/packages/sdk/src/index.ts", import.meta.url),
          ),
        },
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
        {
          find: /^\.\/report-html-template\.mjs$/,
          replacement: fileURLToPath(
            new URL("../src/shared/platform/nodeShims/midscene_report.ts", import.meta.url),
          ),
        },
        {
          find: /^@excalidraw\/mermaid-to-excalidraw$/,
          replacement: fileURLToPath(
            new URL("../src/shared/platform/nodeShims/mermaid_to_excalidraw.ts", import.meta.url),
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
          pet: resolve(process.cwd(), "src/app/pet.html"),
          "computer-cursor": resolve(process.cwd(), "src/app/computer-cursor.html"),
          desktop: resolve(process.cwd(), "src/app/desktop.html"),
        },
      },
      assetsInlineLimit: 0,
      sourcemap: false,
      chunkSizeWarningLimit: 6 * 1024,
    },
    server: {
      fs: {
        allow: [
          process.cwd(),
          fileURLToPath(new URL("../../misty-ui", import.meta.url)),
          fileURLToPath(new URL("../../misty-sdk", import.meta.url)),
        ],
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
      watch: frozen
        ? null
        : {
            ignored: [
              resolve(import.meta.dirname, "../dist/**"),
              "**/target/**",
              resolve(import.meta.dirname, "../.impeccable/**"),
            ],
          },
      hmr: frozen
        ? false
        : tauriDevHost
          ? {
              protocol: "ws",
              host: tauriDevHost,
              port: desktopDevPort,
            }
          : undefined,
    },
  };
});
