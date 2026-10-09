import definitions from "./definitions.json";
export type SettingOwnership = "account" | "resource";
export type SettingsPlatform = "desktop";
export type PreferenceValue = string | number | boolean;
export type PreferenceValues = Record<string, PreferenceValue>;
export interface SettingDefinition {
  id: string;
  label: string;
  page: string;
  section: string;
  key: string;
  default: PreferenceValue;
  owner: SettingOwnership;
  type: "string" | "number" | "boolean";
  platforms: SettingsPlatform[];
  keywords?: string[];
  enum?: string[];
  legacyValues?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  format?: "json";
}
export const settingDefinitions = definitions as SettingDefinition[];
export type SettingSearchEntry = Pick<
  SettingDefinition,
  "id" | "label" | "page" | "owner" | "platforms" | "keywords"
>;
// Controls with their own server APIs are searchable alongside preferences.
// Preference serialization and updates use settingDefinitions exclusively.
export const settingSearchEntries: SettingSearchEntry[] = [
  // Tab orders are edited in place; hidden destinations are searched as "Show in navigation".
  ...settingDefinitions.filter(
    (definition) =>
      definition.id !== "app.navigation.hidden" && !definition.id.startsWith("collections.tabs."),
  ),
  {
    id: "app.navigation.show",
    label: "Show in navigation",
    page: "layout",
    owner: "account",
    platforms: ["desktop"],
    keywords: ["rail", "sidebar", "hide", "Browser", "Agents", "Extensions", "Spaces"],
  },
  {
    id: "agents.misty.enabled",
    label: "Enable Misty",
    page: "misty",
    owner: "account",
    platforms: ["desktop"],
    keywords: ["AI", "copilot", "hosted"],
  },
  {
    id: "agents.memory.retention",
    label: "Conversation retention",
    page: "agents-memory",
    owner: "account",
    platforms: ["desktop"],
    keywords: ["history", "days", "delete"],
  },
  {
    id: "agents.memory.enabled",
    label: "Remembered context",
    page: "agents-memory",
    owner: "account",
    platforms: ["desktop"],
    keywords: ["memory", "remember", "personal"],
  },
  {
    id: "agents.models.catalog",
    label: "Filter models",
    page: "models",
    owner: "account",
    platforms: ["desktop"],
    keywords: ["available", "capabilities", "provider"],
  },
];
export const definitionById = new Map(settingDefinitions.map((d) => [d.id, d]));
export function definitionForLegacy(section: string, key: string) {
  return settingDefinitions.find((d) => d.section === section && d.key === key);
}
export function validPreference(d: SettingDefinition, value: unknown): value is PreferenceValue {
  if (typeof value !== d.type) return false;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (d.min !== undefined && value < d.min) ||
      (d.max !== undefined && value > d.max))
  )
    return false;
  if (
    typeof value === "string" &&
    (value.length > (d.maxLength ?? 4096) || (d.enum && !d.enum.includes(value)))
  )
    return false;
  if (d.id === "app.appearance.accent" && !/^(#[0-9a-f]{6})?$/.test(String(value))) return false;
  if (
    (d.id === "app.appearance.theme_light_start" || d.id === "app.appearance.theme_dark_start") &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))
  )
    return false;
  if (d.format === "json") {
    try {
      const parsed: unknown = JSON.parse(String(value));
      if (!Array.isArray(parsed)) return false;
      if (
        d.id.startsWith("collections.tabs.") ||
        d.id === "app.navigation.hidden" ||
        d.id === "browser.toolbarHidden"
      )
        return (
          parsed.length <= 40 &&
          new Set(parsed).size === parsed.length &&
          parsed.every((id) => typeof id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(id))
        );
      if (d.id === "app.shortcuts.bindings")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.commandId === "string" &&
            [entry.primary, entry.alternate].every(
              (slot) => slot === undefined || slot === null || typeof slot === "string",
            ),
        );
      if (d.id === "browser.siteStyles")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.host === "string" &&
            entry.host.length > 0 &&
            entry.host.length <= 253 &&
            typeof entry.css === "string" &&
            entry.css.length <= 32768 &&
            typeof entry.dark === "boolean",
        );
      if (d.id === "browser.contentBlockingAllowedSites")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.host === "string" &&
            entry.host.length > 0 &&
            entry.host.length <= 253,
        );
      if (d.id === "browser.siteZoom")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.host === "string" &&
            entry.host.length > 0 &&
            entry.host.length <= 253 &&
            typeof entry.factor === "number" &&
            entry.factor >= 0.25 &&
            entry.factor <= 5,
        );
      if (d.id === "app.layout.presets")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.name === "string" &&
            ["left", "right", "top", "bottom"].includes(entry.navigation) &&
            ["left", "right", "top", "bottom"].includes(entry.tabs),
        );
    } catch {
      return false;
    }
  }
  return true;
}
export function fromLegacy(d: SettingDefinition, value: unknown): PreferenceValue {
  const converted = d.legacyValues && typeof value === "number" ? d.legacyValues[value] : value;
  return validPreference(d, converted) ? converted : d.default;
}
export function portableValues(document: Record<string, unknown>): PreferenceValues {
  const values: PreferenceValues = {};
  for (const d of settingDefinitions) {
    const section = document[d.section] as Record<string, unknown> | undefined;
    if (section?.[d.key] !== undefined) values[d.id] = fromLegacy(d, section[d.key]);
  }
  return values;
}
export interface SettingRuntimeAdapter {
  read(document: Record<string, unknown>): PreferenceValue;
  write(document: Record<string, unknown>, value: PreferenceValue): void;
}
// Adapters only translate values. Runtime effects happen through the settings
// store after its durable commit, for both local and remote changes.
export const runtimeAdapters = new Map<string, SettingRuntimeAdapter>(
  settingDefinitions.map((d) => [
    d.id,
    {
      read: (document) =>
        fromLegacy(d, (document[d.section] as Record<string, unknown> | undefined)?.[d.key]),
      write: (document, value) => {
        if (!validPreference(d, value)) throw new Error(`Invalid value for ${d.label}`);
        const section = document[d.section];
        document[d.section] = {
          ...(section && typeof section === "object" ? section : {}),
          [d.key]: d.legacyValues ? d.legacyValues.indexOf(String(value)) : value,
        };
      },
    },
  ]),
);
export function projectPreferences(document: Record<string, unknown>, values: PreferenceValues) {
  const result = structuredClone(document);
  for (const d of settingDefinitions) {
    runtimeAdapters
      .get(d.id)!
      .write(result, validPreference(d, values[d.id]) ? values[d.id] : d.default);
  }
  return result;
}
