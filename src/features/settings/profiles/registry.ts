import definitions from "./definitions.json";
export type SettingOwnership = "profile" | "device" | "account" | "resource";
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
}
export const settingDefinitions = definitions as SettingDefinition[];
export type SettingSearchEntry = Pick<
  SettingDefinition,
  "id" | "label" | "page" | "owner" | "platforms" | "keywords"
>;
// Account and resource controls are discoverable without becoming portable
// values. Profile serialization and updates use settingDefinitions exclusively.
export const settingSearchEntries: SettingSearchEntry[] = [
  ...settingDefinitions,
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
    id: "agents.companion.visible",
    label: "Show cursor companion",
    page: "agents-companion",
    owner: "device",
    platforms: ["desktop"],
    keywords: ["Misty", "cursor", "visibility"],
  },
  {
    id: "agents.companion.size",
    label: "Companion size",
    page: "agents-companion",
    owner: "device",
    platforms: ["desktop"],
    keywords: ["Misty", "cursor", "scale"],
  },
  {
    id: "app.profiles.selection",
    label: "Settings profile",
    page: "profiles",
    owner: "device",
    platforms: ["desktop", "web"],
    keywords: ["select", "switch", "local only"],
  },
  {
    id: "app.profiles.create",
    label: "Profile name",
    page: "profiles",
    owner: "account",
    platforms: ["desktop", "web"],
    keywords: ["create", "duplicate", "copy", "defaults"],
  },
  {
    id: "app.server.endpoint",
    label: "Connect another server",
    page: "server",
    owner: "device",
    platforms: ["desktop"],
    keywords: ["deployment", "self-hosted", "URL", "hosted"],
  },
  {
    id: "app.shortcuts.bindings",
    label: "Search shortcuts",
    page: "shortcuts",
    owner: "device",
    platforms: ["desktop"],
    keywords: ["keyboard", "bindings", "hotkeys", "reassign"],
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
  if (typeof value === "string" && (value.length > 4096 || (d.enum && !d.enum.includes(value))))
    return false;
  return true;
}
export function fromLegacy(d: SettingDefinition, value: unknown): PreferenceValue {
  const converted = d.legacyValues && typeof value === "number" ? d.legacyValues[value] : value;
  return validPreference(d, converted) ? converted : d.default;
}
export function portableValues(document: Record<string, unknown>): PreferenceValues {
  const values: PreferenceValues = {};
  for (const d of settingDefinitions) {
    if (d.owner !== "profile") continue;
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
    if (d.owner !== "profile") continue;
    runtimeAdapters
      .get(d.id)!
      .write(result, validPreference(d, values[d.id]) ? values[d.id] : d.default);
  }
  return result;
}
