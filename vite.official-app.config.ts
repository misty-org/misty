import { appSourceAliases, appSourceDependencies } from "./scripts/app-source-paths.mjs";
import { loadAppEnv, publicAppEnv } from "./scripts/app-env.mjs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { transform } from "esbuild";
import { componentFrameworkGlobals, officialAppComponentFactory } from "./scripts/official-app-component-factory.mjs";
import { officialAppSDKBoundary } from "./scripts/official-app-sdk-boundary.mjs";
import { excalidrawPackageFonts } from "./scripts/excalidraw-package-fonts.mjs";
import { excalidrawSdkInterop } from "./scripts/excalidraw-sdk-interop.mjs";

const env = loadAppEnv(process.cwd());
const appId = env.MISTY_OFFICIAL_APP_ID?.trim().toLowerCase() ?? "";
const platform = env.MISTY_OFFICIAL_APP_PLATFORM === "mobile" ? "mobile" : "desktop";
const outputDirectory = env.MISTY_OFFICIAL_APP_OUT_DIR?.trim();
const supportedApps = new Set([
  "chat",
  "journal",
  "planner",
  "library",
  "inbox",
  "agents",
  "files",
  "browser",
  "code",
  "terminal",
]);

if (!supportedApps.has(appId)) throw new Error(`Unsupported official app: ${appId || "(missing)"}`);
if (!outputDirectory) throw new Error("MISTY_OFFICIAL_APP_OUT_DIR is required.");

const source = resolve(process.cwd(), "src");
const appsRoot = resolve(env.MISTY_APPS_ROOT || resolve(process.cwd(), "../misty-apps"));
const mobile = platform === "mobile";
const spaceApp = new Set(["chat", "journal", "planner", "library"]).has(appId);

function packageSizeReport(): Plugin {
  return {
    name: "misty-official-app-size-report",
    generateBundle(_options, bundle) {
      if (env.MISTY_OFFICIAL_APP_REPORT !== "1") return;
      const modules = Object.values(bundle).flatMap((item) =>
        item.type === "chunk"
          ? Object.entries(item.modules).map(([id, details]) => ({
              id,
              bytes: details.renderedLength,
            }))
          : [],
      );
      modules.sort((left, right) => right.bytes - left.bytes);
      console.log(
        `\nLargest modules in ${appId}/${platform}:\n${modules
          .slice(0, 40)
          .map((item) => `${String(item.bytes).padStart(9)}  ${item.id}`)
          .join("\n")}`,
      );
    },
  };
}

function appDocument(): Plugin {
  return {
    name: "misty-app-document",
    async writeBundle() {
      const script = await readFile(resolve(outputDirectory!, "app.js"));
      const stylesheet = await readFile(resolve(outputDirectory!, "app.css"));
      const integrity = (source: string | Uint8Array) =>
        `sha256-${createHash("sha256").update(source).digest("base64")}`;
      const assetSources = [
        "'self'",
        "misty-extension:",
        "http://misty-extension.localhost",
        "https://apps.mistysys.com",
        "http://localhost:*",
        "http://127.0.0.1:*",
      ].join(" ");
      const csp = [
        "default-src 'none'",
        `script-src ${assetSources}`,
        `style-src ${assetSources} 'unsafe-inline'`,
        `font-src ${assetSources} data:`,
        `img-src ${assetSources} data: blob:`,
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      await writeFile(
        resolve(outputDirectory!, "index.html"),
        [
          "<!doctype html>",
          `<html data-misty-app="${appId}" data-form-factor="${platform}">`,
          '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
          `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
          `<link rel="stylesheet" href="./app.css" integrity="${integrity(stylesheet)}" crossorigin="anonymous">`,
          '</head><body><div id="misty-app-root"></div>',
          `<script type="module" src="./app.js" integrity="${integrity(script)}" crossorigin="anonymous"></script>`,
          "</body></html>",
        ].join(""),
      );
    },
  };
}

function compactExecutablePackage(): Plugin {
  return {
    name: "misty-compact-executable-package",
    async generateBundle(_options, bundle) {
      // These are finished applications. Vite's ES library mode deliberately
      // retains whitespace for downstream bundlers; no downstream build runs here.
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        output.code = (
          await transform(output.code, { minify: true, target: "es2022", legalComments: "inline" })
        ).code;
      }
    },
  };
}

export default defineConfig({
  envDir: false,
  define: {
    ...publicAppEnv(env),
    "import.meta.env.MISTY_OFFICIAL_APP_ID": JSON.stringify(appId),
    // Official apps execute as browser scripts inside the Misty WebView. Some
    // CommonJS dependencies (notably React) branch on this exact expression;
    // leaving it unresolved makes the package crash on a missing Node global
    // before it can register its Misty entry point.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [appSourceDependencies(process.cwd(), appsRoot), officialAppSDKBoundary(), ...(appId === "journal" && !mobile ? [excalidrawSdkInterop(), excalidrawPackageFonts({assetDirectory: resolve(outputDirectory, "../optional-assets")})] : []), react(), tailwindcss(), packageSizeReport(), ...(!mobile ? [officialAppComponentFactory(appId, {framework:true, runtime:appId === "journal"})] : []), compactExecutablePackage(), appDocument()],
  resolve: {
    alias: [
      ...Object.entries(appSourceAliases(process.cwd(), appsRoot)).map(([find, replacement]) => ({ find, replacement })),
      { find: "@", replacement: source },
      { find: "@misty/browser-view", replacement: resolve(appsRoot, "apps/browser/workspace/SDKBrowserView.tsx") },
      { find: "@misty/legacy-social", replacement: resolve(source, "features/apps/package/SDKSocialApp.tsx") },
      { find: "@misty/legacy-inbox", replacement: resolve(source, "features/apps/package/SDKInboxApp.tsx") },
    ],
    dedupe: ["react", "react-dom", "@misty/sdk", "@misty/contracts"],
  },
  build: {
    outDir: resolve(outputDirectory),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    lib: {
      entry: (!mobile || !["chat", "inbox"].includes(appId)) ? resolve(appsRoot, `apps/${appId}/index.tsx`) : resolve(source, `features/apps/package/entries/${appId}.tsx`),
      formats: mobile ? ["es"] : ["iife"],
      name: "MistyComponentBundle",
      fileName: () => "app.js",
    },
    rollupOptions: {
      // Share rendering libraries and Yjs constructors. Documents and stores remain inside
      // each mount's factory, so neither credentials nor tab state are shared.
      external: mobile ? [] : Object.keys(componentFrameworkGlobals),
      output: {
        globals: componentFrameworkGlobals,
        entryFileNames: "app.js",
        // Per-mount module state must include lazy dependencies too.
        inlineDynamicImports: !mobile,
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "app.css" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
