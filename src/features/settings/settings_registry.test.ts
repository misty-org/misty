import "@/app/settings_sections";
import { describe, expect, it } from "vitest";
import { settingDefinitions } from "./device-preferences/registry";
import {
  preferenceSection,
  preferencesWithoutRows,
  settingsAreaEntry,
  settingsAreas,
  settingsGroups,
  settingsPage,
  settingsRegistry,
} from "./SettingsRegistry";
import { settingsSections, type SettingsSection } from "./settings_types";

const areas = settingsGroups.flatMap((group) => group.areas);
const blockIds = new Set(settingsRegistry.map((entry) => entry.id));

describe("settings registry", () => {
  it("keeps a short list of one-word pages, each with its own icon", () => {
    expect(areas.length).toBeLessThanOrEqual(28);
    expect(new Set(areas).size).toBe(areas.length);
    expect(Object.keys(settingsAreas).sort()).toEqual([...areas].sort());
    const labels = areas.map((area) => settingsAreas[area].label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(areas.map((area) => settingsAreas[area].icon)).size).toBe(areas.length);
    for (const label of labels) expect(label).toMatch(/^[A-Z][a-z]+$/);
  });

  it("names groups by feature and never echoes a group in its pages", () => {
    expect(settingsGroups.map((group) => group.label)).toEqual(["Account", "App", "AI"]);
    for (const group of settingsGroups)
      for (const area of group.areas)
        expect(settingsAreas[area].label.toLowerCase()).not.toContain(group.label.toLowerCase());
    for (const entry of settingsRegistry) {
      expect(entry.title ?? "").not.toContain("&");
      expect(entry.title ?? "").not.toMatch(/\band\b/);
    }
  });

  it("gives every page blocks, adjacent and with unique ids", () => {
    expect(blockIds.size).toBe(settingsRegistry.length);
    for (const area of areas) expect(settingsAreaEntry(area)).toBeDefined();
    const order = settingsRegistry.map((entry) => entry.area);
    const seen = new Set<string>();
    order.forEach((area, index) => {
      if (index > 0 && order[index - 1] !== area) expect(seen.has(area)).toBe(false);
      seen.add(area);
    });
  });
});

describe("settings routing", () => {
  it("resolves every section id to a block that exists", () => {
    for (const section of settingsSections) expect(settingsPage(section), section).toBeDefined();
  });

  it("lands every “manage it in Settings” link on the page that holds it", () => {
    const links: Record<string, [SettingsSection, string]> = {
      "update notice": ["updates", "general"],
      "menu bar": ["menu-bar", "general"],
      microphone: ["devices", "voice"],
      thumbnails: ["thumbnails", "server"],
      "reduce motion": ["accessibility", "interface"],
      "website data": ["apps-data", "privacy"],
    };
    for (const [link, [section, area]] of Object.entries(links))
      expect(settingsPage(section)?.area, link).toBe(area);
  });

  it("shows every searchable preference on a page that exists", () => {
    for (const definition of settingDefinitions) {
      if (preferencesWithoutRows.has(definition.id)) continue;
      const section = preferenceSection(definition.id, definition.page);
      expect(settingsPage(section), `${definition.id} → ${section}`).toBeDefined();
    }
    expect(preferenceSection("app.appearance.compact_mode_enabled", "appearance")).toBe("display");
  });
});

describe("settings titles", () => {
  it("never repeats a group, page or section title anywhere in settings", async () => {
    const files = import.meta.glob(
      [
        "./sections/**/*.tsx",
        "../*/settings/**/*.tsx",
        "../agents/models/*.tsx",
        "../updater/UpdatesSection.tsx",
      ],
      { query: "?raw", import: "default", eager: true },
    ) as Record<string, string>;
    const seen = new Map<string, string>();
    const claim = (title: string, where: string) => {
      const owner = seen.get(title);
      if (owner && owner !== where) throw new Error(`"${title}" is used by ${owner} and ${where}`);
      seen.set(title, where);
    };
    for (const group of settingsGroups) claim(group.label, "a sidebar group");
    for (const area of Object.values(settingsAreas)) claim(area.label, "a settings page");
    for (const entry of settingsRegistry)
      if (entry.title) claim(entry.title, `section ${entry.id}`);
    for (const [file, source] of Object.entries(files)) {
      if (file.includes(".test.")) continue;
      const titles = source.matchAll(
        /<(?:Section|SettingsSectionBlock|DesktopSettingsSection)\b[^>]*?\btitle="([^"]+)"/g,
      );
      for (const [, title] of titles) claim(title, file);
    }
  });
});
