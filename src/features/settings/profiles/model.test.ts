import { describe, expect, it } from "vitest";
import {
  effectiveValues,
  editPreference,
  initialProfileState,
  migrateProfileState,
  reconcileProfile,
  resolveSetting,
  type SettingsProfile,
} from "./model";
import {
  portableValues,
  projectPreferences,
  definitionById,
  validPreference,
  settingDefinitions,
} from "./registry";
const profile = (values = {}, revision = 1): SettingsProfile => ({
  id: "account",
  name: "Settings",
  values,
  revision,
  schemaVersion: 1,
});
const selected = () =>
  reconcileProfile(initialProfileState({}), profile({ "browser.searchEngine": "google" }));
describe("account settings", () => {
  it("syncs all registered preferences, including formerly device-only choices", () => {
    expect(settingDefinitions.every((d) => d.owner === "account")).toBe(true);
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
    ).toEqual({
      "browser.searchEngine": "bing",
      "browser.downloads.directory": "/private",
      "app.startup.login": true,
    });
  });
  it("projects shared settings and preserves unknown namespaces", () => {
    const next = projectPreferences(
      { general: { browser_download_directory: "/old" }, plugin: { future: true } },
      { "browser.searchEngine": "brave", "app.zoom": 2 },
    );
    expect(next.general).toMatchObject({
      browser_search_engine_index: 3,
      browser_download_directory: "",
    });
    expect(next.plugin).toEqual({ future: true });
    expect(next.appearance).toMatchObject({ app_zoom: 2 });
  });
  it("migrates the effective legacy profile and overrides into a one-time seed", () => {
    const migrated = migrateProfileState(
      {
        version: 1,
        selectedProfileId: "work",
        profiles: { work: profile({ "browser.searchEngine": "bing" }) },
        overrides: { work: { "files.hidden": true } },
        outbox: [
          {
            id: "old",
            profileId: "work",
            set: { "browser.homepage": "https://example.com" },
            unset: [],
          },
        ],
      },
      { appearance: { app_zoom: 1.25 } },
    );
    expect(migrated.seed).toMatchObject({
      "browser.searchEngine": "bing",
      "files.hidden": true,
      "app.zoom": 1.25,
      "browser.homepage": "https://example.com",
    });
    expect(migrated).not.toHaveProperty("overrides");
    expect(migrated).not.toHaveProperty("selectedProfileId");
  });
  it("uses server values instead of another device's migration seed", () => {
    const old = initialProfileState({ appearance: { app_zoom: 2 } });
    expect(effectiveValues(reconcileProfile(old, profile({ "app.zoom": 1.25 })))).toEqual({
      "app.zoom": 1.25,
    });
  });
  it("keeps offline edits over incoming snapshots until acknowledged", () => {
    let state = editPreference(selected(), "app.zoom", 1.5, "edit");
    state = reconcileProfile(state, profile({ "app.zoom": 1.25, "files.hidden": true }, 2));
    expect(effectiveValues(state)).toEqual({ "app.zoom": 1.5, "files.hidden": true });
    expect(state.outbox).toHaveLength(1);
  });
  it("resets a setting across devices through the outbox", () => {
    const state = editPreference(selected(), "browser.searchEngine", undefined, "reset");
    expect(state.outbox[0].unset).toEqual(["browser.searchEngine"]);
    expect(resolveSetting(state, "browser.searchEngine")).toEqual({
      value: "google",
      source: "default",
    });
  });
  it("ignores older revisions and preserves future server fields", () => {
    const state = reconcileProfile(selected(), profile({ "future.preference": true }, 5));
    expect(reconcileProfile(state, profile({}, 4)).profile?.values).toEqual({
      "future.preference": true,
    });
  });
  it("rejects invalid values and malformed JSON settings", () => {
    expect(() => editPreference(selected(), "browser.searchEngine", "invalid", "x")).toThrow();
    expect(validPreference(definitionById.get("app.appearance.panel_opacity")!, 10)).toBe(false);
    expect(validPreference(definitionById.get("app.shortcuts.bindings")!, "[broken")).toBe(false);
  });
  it("round-trips offline edits without losing mutation IDs", () => {
    const state = editPreference(selected(), "files.hidden", true, "stable-id");
    expect(effectiveValues(JSON.parse(JSON.stringify(state)))).toEqual(effectiveValues(state));
    expect(JSON.parse(JSON.stringify(state)).outbox[0].id).toBe("stable-id");
  });
});

it("validates and queues account tab order preferences", () => {
  const id = "collections.tabs.journal";
  const definition = definitionById.get(id)!;
  for (const invalid of ["{}", "[1]", '["all","all"]', '["bad id"]'])
    expect(validPreference(definition, invalid)).toBe(false);
  const state = editPreference(
    initialProfileState({}),
    id,
    '["drawings","all","notes"]',
    "reorder",
  );
  expect(resolveSetting(state, id).value).toBe('["drawings","all","notes"]');
  expect(state.outbox[0].set[id]).toBe('["drawings","all","notes"]');
});
