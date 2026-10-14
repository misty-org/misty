import { describe, expect, it } from "vitest";
import {
  effectiveValues,
  editPreference,
  initialProfileState,
  migrateProfileState,
  resolveSetting,
} from "./model";
import {
  portableValues,
  projectPreferences,
  definitionById,
  validPreference,
  settingDefinitions,
} from "./registry";
describe("device settings", () => {
  it("registers every preference for the desktop app", () => {
    expect(
      settingDefinitions.every((d) => d.platforms.length === 1 && d.platforms[0] === "desktop"),
    ).toBe(true);
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
  it("migrates the effective legacy profile and overrides into this device's values", () => {
    const migrated = migrateProfileState(
      {
        version: 1,
        selectedProfileId: "work",
        profiles: { work: { values: { "browser.searchEngine": "bing" } } },
        overrides: { work: { "browser.searchSuggestions": true } },
      },
      { appearance: { app_zoom: 1.25 } },
    );
    expect(migrated.values).toMatchObject({
      "browser.searchEngine": "bing",
      "browser.searchSuggestions": true,
      "app.zoom": 1.25,
    });
    expect(migrated).not.toHaveProperty("overrides");
    expect(migrated).not.toHaveProperty("selectedProfileId");
  });
  it("turns an earlier synced state into local values: the copy with its queued edits applied", () => {
    const migrated = migrateProfileState(
      {
        version: 2,
        profile: { values: { "app.zoom": 2, "browser.homepage": "https://old.example" } },
        seed: {},
        outbox: [
          { id: "retired", set: { "files.hidden": true }, unset: [] },
          { id: "mixed", set: { "app.zoom": 1.25 }, unset: ["browser.homepage"] },
        ],
      },
      {},
    );
    // Edits to retired settings are dropped; the rest apply in order.
    expect(migrated).toEqual({ version: 3, values: { "app.zoom": 1.25 } });
  });
  it("keeps current values and drops ones that are no longer valid", () => {
    expect(
      migrateProfileState(
        {
          version: 3,
          values: { "app.zoom": 1.5, "app.zoom.future": 1, "browser.searchEngine": "x" },
        },
        {},
      ),
    ).toEqual({ version: 3, values: { "app.zoom": 1.5 } });
  });
  it("starts from the legacy document when nothing was saved", () => {
    expect(migrateProfileState(null, { appearance: { app_zoom: 1.25 } }).values).toEqual({
      "app.zoom": 1.25,
    });
  });
  it("edits and resets a value locally", () => {
    const state = editPreference(initialProfileState({}), "browser.searchSuggestions", true);
    expect(effectiveValues(state)).toEqual({ "browser.searchSuggestions": true });
    expect(resolveSetting(state, "browser.searchSuggestions")).toEqual({
      value: true,
      source: "device",
    });
    const reset = editPreference(state, "browser.searchSuggestions", undefined);
    expect(effectiveValues(reset)).toEqual({});
    expect(resolveSetting(reset, "browser.searchSuggestions")).toEqual({
      value: false,
      source: "default",
    });
    // An unchanged value returns the same state, so nothing is saved or re-applied.
    expect(editPreference(state, "browser.searchSuggestions", true)).toBe(state);
  });
  it("rejects invalid values and malformed JSON settings", () => {
    expect(() => editPreference(initialProfileState({}), "app.zoom", 10)).toThrow();
    expect(validPreference(definitionById.get("app.zoom")!, 10)).toBe(false);
    expect(validPreference(definitionById.get("app.shortcuts.bindings")!, "[broken")).toBe(false);
  });
  it("round-trips through JSON", () => {
    const state = editPreference(initialProfileState({}), "browser.searchSuggestions", true);
    expect(effectiveValues(JSON.parse(JSON.stringify(state)))).toEqual(effectiveValues(state));
  });
});

it("validates tab order preferences", () => {
  const id = "collections.tabs.journal";
  const definition = definitionById.get(id)!;
  for (const invalid of ["{}", "[1]", '["all","all"]', '["bad id"]'])
    expect(validPreference(definition, invalid)).toBe(false);
  const state = editPreference(initialProfileState({}), id, '["drawings","all","notes"]');
  expect(resolveSetting(state, id).value).toBe('["drawings","all","notes"]');
});
