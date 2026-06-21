import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OfficialApp } from "@/api/apps";
import { invoke } from "@tauri-apps/api/core";
import { localAppComponentReady } from "@/api/apps/api";
import { officialDesktopPackageReady, stageOfficialDesktopPackage } from "./desktopPackages";
import { desktopComponentUrl } from "./desktopAppLoader";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/apps/api", () => ({ localAppComponentReady: vi.fn() }));
const publishedApp = {
  id: "files",
  app_id: "com.misty.files",
  name: "Files",
  official: true,
  publisher: "Misty",
  version: "1.1.0-beta.1",
  minimum_host_protocol: 2,
  desktop: {
    runtime: "downloaded",
    entry: "https://apps.mistysys.com/official-apps/files/1.1.0-beta.1/desktop.zip",
    sha256: "release-hash",
    signature: "release-signature",
    signature_key_id: "release-key",
  },
} as OfficialApp;
const app = {
  ...publishedApp,
  desktop: { ...publishedApp.desktop, entry: "/__misty-local-apps/files/desktop/app.js" },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_MISTY_APPS_DIRECTORY", "/local/misty-apps");
});
afterEach(() => vi.unstubAllEnvs());
it("uses configured local Files despite a published catalog entry and never stages a ZIP", async () => {
  vi.mocked(localAppComponentReady).mockResolvedValue(true);
  expect(await officialDesktopPackageReady(app)).toBe(true);
  expect(await stageOfficialDesktopPackage(app)).toBeNull();
  expect(desktopComponentUrl(app).pathname).toBe("/__misty-local-apps/files/desktop/app.js");
  expect(vi.mocked(localAppComponentReady).mock.calls[0][0].pathname).toBe(
    "/__misty-local-apps/files/desktop/app.js",
  );
  expect(invoke).not.toHaveBeenCalled();
});
it("reports a missing local build without falling back to the published ZIP", async () => {
  vi.mocked(localAppComponentReady).mockResolvedValue(false);
  await expect(stageOfficialDesktopPackage(app)).rejects.toThrow(
    "Build Files in the local Apps repository first.",
  );
  expect(invoke).not.toHaveBeenCalled();
});
it("keeps the signed installer for production builds", async () => {
  vi.stubEnv("DEV", false);
  vi.mocked(invoke).mockResolvedValue("operation");
  expect(await stageOfficialDesktopPackage(publishedApp)).toBe("operation");
  expect(invoke).toHaveBeenCalledWith(
    "install_plugin_bundle",
    expect.objectContaining({ url: publishedApp.desktop.entry, signature: "release-signature" }),
  );
  expect(localAppComponentReady).not.toHaveBeenCalled();
});

it("loads immutable package URLs independently for different releases", () => {
  vi.stubEnv("DEV", false);
  const first = desktopComponentUrl(publishedApp);
  const second = desktopComponentUrl({
    ...publishedApp,
    version: "2",
    desktop: { ...publishedApp.desktop, sha256: "another-release" },
  });
  expect(first.pathname).toBe("/public/releases/release-hash/files/web/app.js");
  expect(second.pathname).toBe("/public/releases/another-release/files/web/app.js");
  expect(first.pathname).not.toBe(second.pathname);
});

it("downloads the signed local ZIP when a development component needs native services", async () => {
  vi.mocked(invoke).mockResolvedValue("operation");
  await stageOfficialDesktopPackage(app, true);
  expect(invoke).toHaveBeenCalledWith("install_plugin_bundle", expect.objectContaining({
    url: new URL(`/official-apps/files/${app.version}/desktop.zip`, window.location.origin).href,
    sha256: app.desktop.sha256, signature: app.desktop.signature,
  }));
  expect(localAppComponentReady).not.toHaveBeenCalled();
});
