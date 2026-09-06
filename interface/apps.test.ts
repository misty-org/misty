import { describe, expect, it } from "vitest";

import catalog from "../apps/catalog.json";
import {
  officialAppSupportsDesktop,
  officialAppSupportsMobile,
  type MistyOfficialAppCatalog,
} from "./apps";

const officialCatalog = catalog as MistyOfficialAppCatalog;

describe("official app catalog", () => {
  it("contains the agreed official apps exactly once", () => {
    expect(officialCatalog.apps.map((app) => app.id)).toEqual([
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
    expect(officialCatalog.apps.some((app) => app.id === "transfers")).toBe(
      false,
    );
  });

  it("keeps development tools off mobile", () => {
    for (const id of ["code", "terminal"]) {
      const app = officialCatalog.apps.find(
        (candidate) => candidate.id === id,
      )!;
      expect(officialAppSupportsDesktop(app)).toBe(true);
      expect(officialAppSupportsMobile(app)).toBe(false);
    }
  });

  it("keeps migrated desktop apps downloadable with complete signed artifacts", () => {
    expect(
      officialCatalog.apps
        .filter((app) => app.mobile.runtime !== "unsupported")
        .every((app) => app.mobile.runtime === "embedded"),
    ).toBe(true);
    for (const id of ["planner", "terminal"]) {
      const app = officialCatalog.apps.find((candidate) => candidate.id === id)!;
      expect(app.desktop.runtime).toBe("downloaded");
      expect(app.minimum_host_protocol).toBe(2);
      expect(app.desktop.entry).toMatch(/^https:\/\/.+\/desktop\.zip$/);
      expect(app.desktop.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(app.desktop.signature).toBeTruthy();
      expect(app.desktop.signature_key_id).toBe(officialCatalog.signing?.key_id);
      expect(app.desktop.download_bytes).toBeGreaterThan(0);
    }
    expect(officialCatalog.apps.every((app) => ["downloaded", "embedded"].includes(app.desktop.runtime))).toBe(true);
    expect(
      officialCatalog.apps.every(
        (app) => app.mobile.runtime === "unsupported" || !app.mobile.entry,
      ),
    ).toBe(true);
  });
});
