import { expect, it } from "vitest";
import type { OfficialApp } from "./api";
import { installedDevelopmentRelease } from "./developmentRelease";
const saved = {
  id: "browser", official: true, publisher: "Misty", version: "1", permission_version: 1,
  minimum_host_protocol: 1, scopes: ["browser.read"],
  desktop: { runtime: "downloaded", entry: "https://apps.mistysys.com/browser.zip" },
} as OfficialApp;
const local = { ...saved, desktop: { ...saved.desktop, entry: "/__misty-local-apps/browser/desktop/app.js" } };
it("opens the matching local artifact while retaining the saved release contract", () => {
  expect(installedDevelopmentRelease(saved, [local], true)).toEqual({ ...saved, desktop: local.desktop });
  expect(installedDevelopmentRelease(saved, [local], false)).toBe(saved);
});
it("never substitutes a different release or permission contract", () => {
  for (const changed of [{ version: "2" }, { permission_version: 2 }, { scopes: ["files.write"] }, { requires_apps: ["files"] }]) {
    expect(installedDevelopmentRelease(saved, [{ ...local, ...changed }], true)).toBe(saved);
  }
});
