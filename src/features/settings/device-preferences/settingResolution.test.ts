import { describe, expect, it } from "vitest";
import {
  effectiveValues,
  editPreference,
  initialPreferencesState,
  migratePreferencesState,
  resolveSetting,
} from "./settingResolution";
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
          startup_view_index: 2,
          launch_on_login: true,
        },
        ai: { api_key: "secret" },
        custom: { value: true },
      }),
    ).toEqual({
      "app.startup.view": "agents",
      "app.startup.login": true,
    });
  });
  it("projects shared settings and preserves unknown namespaces", () => {
    const next = projectPreferences(
      { general: { startup_view_index: 0 }, plugin: { future: true } },
      { "app.startup.view": "agents", "app.zoom": 2 },
    );
    expect(next.general).toMatchObject({ startup_view_index: 2 });
    expect(next.plugin).toEqual({ future: true });
    expect(next.appearance).toMatchObject({ app_zoom: 2 });
  });
  it("migrates the effective legacy profile and overrides into this device's values", () => {
    const migrated = migratePreferencesState(
      {
        version: 1,
        selectedProfileId: "work",
        profiles: { work: { values: { "app.startup.view": "files" } } },
        overrides: { work: { "app.startup.login": true } },
      },
      { appearance: { app_zoom: 1.25 } },
    );
    expect(migrated.values).toMatchObject({
      "app.startup.view": "files",
      "app.startup.login": true,
      "app.zoom": 1.25,
    });
    expect(migrated).not.toHaveProperty("overrides");
    expect(migrated).not.toHaveProperty("selectedProfileId");
  });
  it("turns an earlier synced state into local values: the copy with its queued edits applied", () => {
    const migrated = migratePreferencesState(
      {
        version: 2,
        profile: { values: { "app.zoom": 2, "files.startingFolder": "/old" } },
        seed: {},
        outbox: [
          { id: "retired", set: { "files.hidden": true }, unset: [] },
          { id: "mixed", set: { "app.zoom": 1.25 }, unset: ["files.startingFolder"] },
        ],
      },
      {},
    );
    // Edits to retired settings are dropped; the rest apply in order.
    expect(migrated).toEqual({ version: 3, values: { "app.zoom": 1.25 } });
  });
  it("keeps current values and drops ones that are no longer valid", () => {
    expect(
      migratePreferencesState(
        {
          version: 3,
          values: { "app.zoom": 1.5, "app.zoom.future": 1, "app.startup.view": "x" },
        },
        {},
      ),
    ).toEqual({ version: 3, values: { "app.zoom": 1.5 } });
  });
  it("starts from the legacy document when nothing was saved", () => {
    expect(migratePreferencesState(null, { appearance: { app_zoom: 1.25 } }).values).toEqual({
      "app.zoom": 1.25,
    });
  });
  it("edits and resets a value locally", () => {
    const state = editPreference(initialPreferencesState({}), "app.startup.login", true);
    expect(effectiveValues(state)).toEqual({ "app.startup.login": true });
    expect(resolveSetting(state, "app.startup.login")).toEqual({
      value: true,
      source: "device",
    });
    const reset = editPreference(state, "app.startup.login", undefined);
    expect(effectiveValues(reset)).toEqual({});
    expect(resolveSetting(reset, "app.startup.login")).toEqual({
      value: false,
      source: "default",
    });
    // An unchanged value returns the same state, so nothing is saved or re-applied.
    expect(editPreference(state, "app.startup.login", true)).toBe(state);
  });
  it("rejects invalid values and malformed JSON settings", () => {
    expect(() => editPreference(initialPreferencesState({}), "app.zoom", 10)).toThrow();
    expect(validPreference(definitionById.get("app.zoom")!, 10)).toBe(false);
    expect(validPreference(definitionById.get("app.shortcuts.bindings")!, "[broken")).toBe(false);
  });
  it("round-trips through JSON", () => {
    const state = editPreference(initialPreferencesState({}), "app.startup.login", true);
    expect(effectiveValues(JSON.parse(JSON.stringify(state)))).toEqual(effectiveValues(state));
  });
});

it("validates tab order preferences", () => {
  const id = "collections.tabs.journal";
  const definition = definitionById.get(id)!;
  for (const invalid of ["{}", "[1]", '["all","all"]', '["bad id"]'])
    expect(validPreference(definition, invalid)).toBe(false);
  const state = editPreference(initialPreferencesState({}), id, '["drawings","all","notes"]');
  expect(resolveSetting(state, id).value).toBe('["drawings","all","notes"]');
});
