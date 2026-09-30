import definitions from "./definitions.json";
export type SettingOwnership = "account" | "resource";
export type SettingsPlatform = "desktop" | "web";
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
  // Retain stored preset data for compatibility, but no longer offer that control.
  ...settingDefinitions.filter((definition) => definition.id !== "app.layout.presets"),
  {
    id: "agents.misty.enabled",
    label: "Enable Misty",
    page: "misty",
    owner: "account",
    platforms: ["desktop", "web"],
    keywords: ["AI", "copilot", "hosted"],
  },
  {
    id: "agents.memory.retention",
    label: "Conversation retention",
    page: "agents-memory",
    owner: "account",
    platforms: ["desktop", "web"],
    keywords: ["history", "days", "delete"],
  },
  {
    id: "agents.memory.enabled",
    label: "Remembered context",
    page: "agents-memory",
    owner: "account",
    platforms: ["desktop", "web"],
    keywords: ["memory", "remember", "personal"],
  },
  {
    id: "agents.models.catalog",
    label: "Filter models",
    page: "models",
    owner: "account",
    platforms: ["desktop", "web"],
    keywords: ["available", "capabilities", "provider"],
  },
  {
    id: "app.server.endpoint",
    label: "Connect another server",
    page: "server",
    owner: "account",
    platforms: ["desktop"],
    keywords: ["deployment", "self-hosted", "URL", "hosted"],
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
  if (d.format === "json") {
    try {
      const parsed: unknown = JSON.parse(String(value));
      if (d.id === "files.openWith")
        return Boolean(
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.values(parsed).every((path) => typeof path === "string" && path.length <= 4096),
        );
      if (!Array.isArray(parsed)) return false;
      if (d.id === "app.shortcuts.bindings")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.commandId === "string" &&
            [entry.primary, entry.alternate].every(
              (slot) => slot === undefined || slot === null || typeof slot === "string",
            ),
        );
      if (d.id === "app.layout.presets")
        return parsed.every(
          (entry) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.name === "string" &&
            ["left", "right", "top", "bottom"].includes(entry.navigation) &&
            ["left", "right", "top", "bottom"].includes(entry.tabs) &&
            entry.navigation !== entry.tabs,
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
  if (document.open_with && typeof document.open_with === "object") {
    const associations = JSON.stringify(document.open_with);
    if (validPreference(definitionById.get("files.openWith")!, associations))
      values["files.openWith"] = associations;
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
  const associations = values["files.openWith"];
  result.open_with = validPreference(definitionById.get("files.openWith")!, associations)
    ? JSON.parse(String(associations))
    : {};
  return result;
}
