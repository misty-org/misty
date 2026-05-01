import { describe, expect, it } from "vitest";

import {
  isSettingsPathname,
  settingsPathForTab,
  settingsTabFromPathname,
} from "@/pages/AccountSettings/settingsRoute";
import { safeInternalPath } from "@/lib/navigation";

describe("settings route", () => {
  it("maps settings paths to tabs", () => {
    expect(settingsTabFromPathname("/settings")).toBe("account");
    expect(settingsTabFromPathname("/settings/")).toBe("account");
    expect(settingsTabFromPathname("/settings/account")).toBe("account");
    expect(settingsTabFromPathname("/settings/usage")).toBe("usage");
    expect(settingsTabFromPathname("/settings/billing")).toBe("billing");
    expect(settingsTabFromPathname("/settings/privacy")).toBe("privacy");
  });

  it("reports an unknown tab as null so the caller can redirect", () => {
    expect(settingsTabFromPathname("/settings/not-a-tab")).toBeNull();
    expect(isSettingsPathname("/settings/not-a-tab")).toBe(true);
  });

  it("does not claim unrelated paths", () => {
    expect(settingsTabFromPathname("/")).toBeNull();
    expect(settingsTabFromPathname("/pricing")).toBeNull();
    expect(isSettingsPathname("/pricing")).toBe(false);
    // A path that merely starts with the same letters is not a settings route.
    expect(isSettingsPathname("/settingsomething")).toBe(false);
  });

  it("round-trips a tab through its path", () => {
    expect(settingsTabFromPathname(settingsPathForTab("billing"))).toBe(
      "billing",
    );
  });
});

describe("safeInternalPath", () => {
  it("accepts same-site absolute paths", () => {
    expect(safeInternalPath("/settings/billing")).toBe("/settings/billing");
  });

  it("rejects anything that could leave the site", () => {
    expect(safeInternalPath("https://evil.example.com")).toBeNull();
    expect(safeInternalPath("//evil.example.com")).toBeNull();
    expect(safeInternalPath("settings")).toBeNull();
    expect(safeInternalPath("")).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });

  it("ignores a non-string, so `onClick={logout}` cannot throw", () => {
    // TypeScript permits passing a zero-arg handler where the implementation
    // takes an optional argument, so a DOM event really does arrive here.
    expect(safeInternalPath(new MouseEvent("click"))).toBeNull();
    expect(safeInternalPath(42)).toBeNull();
    expect(safeInternalPath({})).toBeNull();
  });
});
