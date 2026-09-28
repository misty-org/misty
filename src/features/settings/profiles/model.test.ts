import { describe, expect, it } from "vitest";
import {
  effectiveValues,
  editPreference,
  initialProfileState,
  reconcileProfiles,
  resolveSetting,
  type SettingsProfile,
} from "./model";
import { portableValues, projectPreferences, definitionById, validPreference } from "./registry";
const profile = (id: string, values = {}, revision = 1): SettingsProfile => ({
  id,
  name: id,
  values,
  revision,
  schemaVersion: 1,
});
function selected() {
  const s = initialProfileState({});
  s.profiles.work = profile("work", { "browser.searchEngine": "google" });
  s.profiles.personal = profile("personal");
  s.selectedProfileId = "work";
  return s;
}
describe("profile resolution and offline edits", () => {
  it("migrates stable enum IDs without uploading paths, grants, credentials or unknown data", () => {
    expect(
      portableValues({
        general: {
          browser_search_engine_index: 2,
          browser_download_directory: "/private",
          launch_on_login: true,
        },
        ai: { api_key: "secret" },
        custom: { value: true },
      }),
    ).toEqual({ "browser.searchEngine": "bing" });
  });
  it("projects only portable values and preserves device and unknown namespaces", () => {
    const document = {
      general: { browser_download_directory: "/downloads" },
      plugin: { future: true },
    };
    const next = projectPreferences(document, { "browser.searchEngine": "brave", "app.zoom": 2 });
    expect(next.general).toMatchObject({
      browser_search_engine_index: 3,
      browser_download_directory: "/downloads",
    });
    expect(next.plugin).toEqual(document.plugin);
    expect(next.appearance).not.toHaveProperty("app_zoom");
  });
  it("keeps profile edits attached to their profile through switching", () => {
    const s = editPreference(selected(), "browser.searchEngine", "bing", "profile", "edit-1");
    s.selectedProfileId = "personal";
    expect(effectiveValues(s)["browser.searchEngine"]).toBeUndefined();
    expect(s.outbox[0].profileId).toBe("work");
    s.selectedProfileId = "work";
    expect(effectiveValues(s)["browser.searchEngine"]).toBe("bing");
  });
  it("retains device overrides through incoming edits and removes them explicitly", () => {
    let s = editPreference(selected(), "browser.searchEngine", "brave", "device", "unused");
    s = reconcileProfiles(s, [
      profile("work", { "browser.searchEngine": "bing" }, 2),
      profile("personal"),
    ]);
    expect(resolveSetting(s, "browser.searchEngine")).toEqual({ value: "brave", source: "device" });
    s = editPreference(s, "browser.searchEngine", undefined, "device", "unused");
    expect(resolveSetting(s, "browser.searchEngine")).toEqual({ value: "bing", source: "profile" });
  });
  it("does not create overrides merely by selecting a profile", () => {
    expect(selected().overrides).toEqual({});
  });
  it("resets profile keys through the outbox without dropping unrelated values", () => {
    const s = editPreference(selected(), "browser.searchEngine", undefined, "profile", "reset");
    expect(s.outbox[0].unset).toEqual(["browser.searchEngine"]);
    expect(resolveSetting(s, "browser.searchEngine")).toEqual({
      value: "google",
      source: "default",
    });
  });
  it("preserves pending and overridden values locally after remote deletion", () => {
    let s = editPreference(selected(), "browser.searchEngine", "bing", "profile", "edit");
    s = editPreference(s, "files.hidden", true, "device", "unused");
    s = reconcileProfiles(s, [profile("personal")]);
    expect(s.selectedProfileId).toBeNull();
    expect(s.outbox).toEqual([]);
    expect(s.localValues).toMatchObject({ "browser.searchEngine": "bing", "files.hidden": true });
    expect(s.notice).toContain("deleted");
  });
  it("ignores older revisions and retains future fields", () => {
    const s = selected();
    s.profiles.work = profile("work", { "future.preference": true }, 5);
    expect(reconcileProfiles(s, [profile("work", {}, 4)]).profiles.work.values).toEqual({
      "future.preference": true,
    });
  });
  it("rejects device keys, invalid enums and out-of-range settings", () => {
    expect(() =>
      editPreference(selected(), "browser.downloads.directory", "/tmp", "profile", "x"),
    ).toThrow();
    expect(() =>
      editPreference(selected(), "browser.searchEngine", "invalid", "profile", "x"),
    ).toThrow();
    expect(validPreference(definitionById.get("app.appearance.panel_opacity")!, 10)).toBe(false);
  });
  it("round-trips an offline outbox through JSON without losing intent IDs", () => {
    const s = editPreference(selected(), "files.hidden", true, "profile", "stable-id");
    expect(effectiveValues(JSON.parse(JSON.stringify(s)))).toEqual(effectiveValues(s));
    expect(JSON.parse(JSON.stringify(s)).outbox[0].id).toBe("stable-id");
  });
});
