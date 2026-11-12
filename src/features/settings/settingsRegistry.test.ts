import "@/app/SettingsSections";
import { describe, expect, it } from "vitest";
import { settingDefinitions } from "./device-preferences/registry";
import {
  canonicalSettingsSection,
  preferenceSection,
  preferencesWithoutRows,
  settingsAreaEntry,
  settingsAreas,
  settingsGroups,
  settingsPage,
  settingsRegistry,
} from "./settingsRegistry";
import { settingsSections, type SettingsSection } from "./settingsTypes";

const areas = settingsGroups.flatMap((group) => group.areas);
const blockIds = new Set(settingsRegistry.map((entry) => entry.id));

describe("settings registry", () => {
  it("keeps a short list of one-word pages, each with its own icon", () => {
    expect(areas.length).toBeLessThanOrEqual(15);
    expect(new Set(areas).size).toBe(areas.length);
    expect(Object.keys(settingsAreas).sort()).toEqual([...areas].sort());
    const labels = areas.map((area) => settingsAreas[area].label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(areas.map((area) => settingsAreas[area].icon)).size).toBe(areas.length);
    for (const label of labels) expect(label).toMatch(/^[A-Z][a-z]+$/);
  });

  it("names groups by feature and never echoes a group in its pages", () => {
    expect(settingsGroups.map((group) => group.label)).toEqual(["Account", "App", "Agents"]);
    for (const group of settingsGroups)
      for (const area of group.areas)
        expect(settingsAreas[area].label.toLowerCase()).not.toContain(group.label.toLowerCase());
    for (const entry of settingsRegistry) {
      expect(entry.label).not.toContain("&");
      expect(entry.label).not.toMatch(/\band\b/);
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
  it("resolves every section id, retired or not, to a block that exists", () => {
    for (const section of settingsSections)
      expect(blockIds.has(canonicalSettingsSection(section)), section).toBe(true);
  });

  it("sends retired pages to where their settings live now", () => {
    expect(settingsPage("diagnostics")?.area).toBe("advanced");
    expect(settingsPage("browser")?.area).toBe("general");
    expect(settingsPage("search")?.id).toBe("general");
    expect(settingsPage("browser-handoff")?.id).toBe("account");
    expect(settingsPage("sync")?.id).toBe("account");
    expect(settingsPage("about")?.id).toBe("account");
  });

  it("lands every “manage it in Settings” link on the page that holds it", () => {
    const links: Record<string, [SettingsSection, string]> = {
      "update notice": ["updates", "general"],
      "clipboard devices": ["devices", "account"],
    };
    for (const [link, [section, area]] of Object.entries(links))
      expect(settingsPage(section)?.area, link).toBe(area);
  });

  it("shows every searchable preference on a page that exists", () => {
    for (const definition of settingDefinitions) {
      if (preferencesWithoutRows.has(definition.id)) continue;
      const section = preferenceSection(definition.id, definition.page);
      expect(blockIds.has(section), `${definition.id} → ${section}`).toBe(true);
    }
    expect(preferenceSection("app.diagnostics.framePacing", "about")).toBe("advanced");
    expect(preferenceSection("browser.downloads.prompt", "browser-downloads")).toBe(
      "browser-downloads",
    );
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
      // The same section in another state (loading, signed out) keeps its title within one file.
      if (owner && owner !== where) throw new Error(`"${title}" is used by ${owner} and ${where}`);
      seen.set(title, where);
    };
    for (const group of settingsGroups) claim(group.label, "a sidebar group");
    for (const area of Object.values(settingsAreas)) claim(area.label, "a settings page");
    for (const [file, source] of Object.entries(files)) {
      if (file.includes(".test.")) continue;
      const titles = source.matchAll(
        /<(?:Section|SettingsSectionBlock|DesktopSettingsSection)\b[^>]*?\btitle="([^"]+)"/g,
      );
      for (const [, title] of titles) claim(title, file);
    }
  });
});
