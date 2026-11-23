import { Pressable, Surface, Text } from "@misty/ui";
import { settingSearchEntries } from "../device-preferences/registry";
import {
  preferenceSection,
  preferencesWithoutRows,
  settingsAreaEntry,
  settingsAreas,
  settingsGroups,
  settingsPage,
  settingsPageTitle,
} from "../SettingsRegistry";
import type { SettingsSection } from "../settings_types";
export interface SettingsSearchResult {
  key: string;
  label: string;
  page: SettingsSection;
  focus: string;
}
export function searchSettings(query: string): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const rows = settingSearchEntries
    .filter((d) => !preferencesWithoutRows.has(d.id) && settingsPage(d.page as SettingsSection))
    .filter((d) =>
      `${d.label} ${d.id} ${d.page} ${d.keywords?.join(" ") ?? ""}`.toLowerCase().includes(needle),
    )
    .map((d) => ({
      key: d.id,
      label: d.label,
      page: preferenceSection(d.id, d.page),
      focus: d.label,
    }));
  const pages = settingsGroups
    .flatMap((group) => group.areas)
    .filter((area) => settingsAreas[area].label.toLowerCase().includes(needle))
    .flatMap((area) => {
      const entry = settingsAreaEntry(area);
      return entry
        ? [{ key: `page:${entry.id}`, label: settingsAreas[area].label, page: entry.id, focus: "" }]
        : [];
    });
  return [...pages, ...rows];
}
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || !query.trim()) return <>{text}</>;
  const end = at + query.trim().length;
  return (
    <>
      {text.slice(0, at)}
      <Surface as="mark" tone="active" className="rounded-sm">
        <Text bare tone="bright">
          {text.slice(at, end)}
        </Text>
      </Surface>
      {text.slice(end)}
    </>
  );
}
export function SettingsSearchResults(props: {
  query: string;
  results: SettingsSearchResult[];
  onSelect: (result: SettingsSearchResult) => void;
}) {
  return (
    <div
      aria-label="Settings search results"
      className="misty-scrollbar grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-3 [scrollbar-gutter:stable] max-[748px]:px-2"
    >
      {props.results.map((result) => {
        const page = settingsPage(result.page)!;
        return (
          <Pressable
            key={result.key}
            wash="control"
            className="grid gap-0.5 rounded-md px-2.5 py-1.5 text-left"
            onClick={() => props.onSelect(result)}
          >
            <Text size="control" tone="default" full={result.label}>
              <Highlighted text={result.label} query={props.query} />
            </Text>
            {result.focus ? (
              <Text size="meta" tone="muted">
                {settingsPageTitle(page)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {!props.results.length ? (
        <Text as="p" size="meta" tone="muted" className="px-2.5 py-1.5">
          No settings match “{props.query.trim()}”
        </Text>
      ) : null}
    </div>
  );
}
