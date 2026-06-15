import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();

function source(path: string) {
  return readFileSync(resolve(repo, path), "utf8");
}

describe("Mini App shell boundary", () => {
  it("does not import retired built-in screens from desktop routing", () => {
    const routing = source("src/application/routing/routeConfig.tsx");
    const surface = source("src/application/layouts/DesktopLayout/WorkspaceSurface.tsx");
    const combined = `${routing}\n${surface}`;

    for (const retired of [
      "AgentsPage",
      "BrowserWorkspace",
      "DeveloperWorkspace",
      "FilesPage",
      "InboxWorkspace",
      "TerminalWorkspace",
      "TransfersWorkspace",
    ]) {
      expect(combined).not.toContain(retired);
    }
    expect(surface).toContain("OfficialAppRuntimePage");
  });

  it("routes mobile App tabs through the shared runtime", () => {
    const surface = source("src/application/layouts/MobileLayout/MobileWorkspaceSurface.tsx");
    expect(surface).toContain("OfficialAppRuntimePage");
    expect(surface).not.toContain("BrowserWorkspace");
    expect(surface).not.toContain("InboxWorkspace");
    expect(surface).not.toContain("MobileFilesPage");
  });

  it("keeps untrusted apps in native views and uses an SDK component host for signed apps", () => {
    for (const path of [
      "src/features/apps/OfficialAppPackageHost.tsx",
      "src/features/apps/NativeAppView.tsx",
      "src/features/files/explorer/workspace/explorerPlugins/pluginPanelHosts.tsx",
    ]) {
      expect(source(path)).not.toContain("<iframe");
      expect(source(path)).not.toContain("srcDoc=");
    }
    expect(source("src/features/apps/OfficialAppRuntimePage.tsx")).toContain("TrustedAppSurface");
    expect(source("src/features/apps/OfficialAppRuntimePage.tsx")).toContain(
      "DownloadedAppSurface",
    );
    expect(source("src/features/apps/DownloadedAppSurface.tsx")).not.toContain("<iframe");
    const native = source("src-tauri/src/platform/mini_app.rs");
    expect(native).toContain(".incognito(true)");
    expect(native).toContain("context.webview_label()");
    expect(native).toContain("frame-src 'none'");
    expect(source("src-tauri/capabilities/default.json")).toContain('"webviews": ["main"]');
  });

  it("permits verified local package imports without remote script origins or a website iframe", () => {
    expect(source("src/features/browser/BrowserWorkspace.tsx")).not.toContain("<iframe");
    const config = JSON.parse(source("src-tauri/tauri.conf.json")) as {
      app: { security: { csp: string } };
    };
    const csp = config.app.security.csp;
    expect(csp).toContain("frame-src 'self'");
    const directives = Object.fromEntries(
      csp.split(";").map((directive) => {
        const [name, ...sources] = directive.trim().split(/\s+/);
        return [name, sources];
      }),
    );
    expect(directives["script-src"]).toEqual([
      "'self'",
      "misty-extension:",
      "http://misty-extension.localhost",
    ]);
    expect(directives["style-src"]).toContain("misty-extension:");
    expect(directives["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("keeps credentials behind the SDK capability gateway", () => {
    const packageTypes = source("src/features/apps/package/types.ts");
    const packageRuntime = source("src/features/apps/package/runtime.tsx");
    const build = source("vite.official-app.config.ts");

    expect(packageTypes).not.toMatch(/\btoken:\s*string/);
    expect(packageTypes).not.toMatch(/\bserverBase:\s*string/);
    expect(packageRuntime).not.toContain("document.currentScript");
    expect(packageRuntime).not.toContain("__MISTY_OFFICIAL_APP_PACKAGES__");
    expect(build).toContain("officialAppComponentFactory");
    expect(build).toContain("officialAppSDKBoundary()");
    expect(build).toContain('type="module"');
    expect(build).toContain("connect-src 'none'");
  });
});
