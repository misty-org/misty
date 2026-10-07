import { settingDefinitions as definitions } from "@/features/settings/settingDefinitions";
import { installations } from "@/features/extensions/store";
import { resultLimit, type ScopedSearchResult } from "../scopedSearchSources";

function openSettings(section: string): () => void {
  return () =>
    window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section } }));
}

/** The words each settings page answers to: its own setting labels and keywords. */
const settingWords = new Map<string, string[]>();
for (const definition of definitions as { page: string; label: string; keywords?: string[] }[])
  settingWords.set(definition.page, [
    ...(settingWords.get(definition.page) ?? []),
    definition.label,
    ...(definition.keywords ?? []),
  ]);

/**
 * Settings pages by name, area or any setting on them. The registry pulls in
 * every settings screen, so it loads only once someone searches settings.
 */
export async function searchSettingsPages(query: string): Promise<ScopedSearchResult[]> {
  const { settingsAreas, settingsPageTitle, settingsRegistry } =
    await import("@/features/settings/settingsRegistry");
  const needle = query.trim().toLocaleLowerCase();
  const pages = settingsRegistry.filter(
    (entry) =>
      !needle ||
      [entry.label, settingsAreas[entry.area].label, ...(settingWords.get(entry.id) ?? [])].some(
        (word) => word.toLocaleLowerCase().includes(needle),
      ),
  );
  return pages.slice(0, resultLimit).map((entry) => ({
    id: `setting:${entry.id}`,
    kind: "setting",
    title: settingsPageTitle(entry),
    subtitle: "Settings",
    target: { kind: "run", run: openSettings(entry.id) },
  }));
}

export function searchExtensions(query: string): ScopedSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  const installed = installations()
    .filter((item) => item.installed && item.name.toLocaleLowerCase().includes(needle))
    .slice(0, resultLimit)
    .map<ScopedSearchResult>((item) => ({
      id: `extension:${item.id}`,
      kind: "extension",
      title: item.name,
      subtitle: item.enabled ? "Extension" : "Extension · Off",
      target: { kind: "route", route: `/extensions/addon/${item.id}` },
    }));
  if (needle) return installed;
  return [
    {
      id: "extensions:manage",
      kind: "action",
      title: "Manage extensions",
      subtitle: "Installed extensions",
      target: { kind: "route", route: "/extensions/installed" },
    },
    ...installed.slice(0, resultLimit - 1),
  ];
}
