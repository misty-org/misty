import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficialApp } from "@/api/apps";
import { localDesktopComponentUrl } from "./localDesktopApp";

const app = {
  id: "journal",
  app_id: "com.misty.journal",
  publisher: "Misty",
  official: true,
  desktop: { runtime: "downloaded", entry: "/__misty-local-apps/journal/desktop/app.js" },
} as OfficialApp;

afterEach(() => vi.unstubAllEnvs());
describe("local desktop components", () => {
  it("loads a known local component only when a development directory is configured", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_MISTY_APPS_DIRECTORY", "/local/apps");
    expect(localDesktopComponentUrl(app)?.pathname).toBe(app.desktop.entry);
    expect(
      localDesktopComponentUrl({
        ...app,
        desktop: {
          ...app.desktop,
          entry: "https://apps.mistysys.com/official-apps/journal/1.1.0-beta.1/desktop.zip",
        },
      }),
    ).toBeNull();
    expect(localDesktopComponentUrl({ ...app, id: "unknown" })).toBeNull();
  });
  it("never bypasses published package verification in production or without a local directory", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_MISTY_APPS_DIRECTORY", "/local/apps");
    expect(localDesktopComponentUrl(app)).toBeNull();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_MISTY_APPS_DIRECTORY", "");
    expect(localDesktopComponentUrl(app)).toBeNull();
  });
});
