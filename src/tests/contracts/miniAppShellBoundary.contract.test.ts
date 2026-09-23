import { readFileSync } from "node:fs";
import { sourcePath } from "./repositoryPolicy";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(sourcePath(path), "utf8");
}

describe("Mini App shell boundary", () => {
  it("keeps remaining plugin surfaces in isolated native views", () => {
    for (const path of [
      "src/features/apps/OfficialAppPackageHost.tsx",
      "src/features/apps/NativeAppView.tsx",
      "src/features/files/explorer/workspace/explorerPlugins/pluginPanelHosts.tsx",
    ]) {
      expect(source(path)).not.toContain("<iframe");
      expect(source(path)).not.toContain("srcDoc=");
    }
    const native = source("src-tauri/src/platform/mini_app.rs");
    expect(native).toContain(".incognito(true)");
    expect(native).toContain("context.webview_label()");
    expect(native).toContain("frame-src 'none'");
    const capability = JSON.parse(source("src-tauri/capabilities/default.json"));
    // Both labels host local application pages; embedded websites must remain excluded.
    expect(capability.webviews).toEqual(["main", "misty-agent-*"]);
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
