import { Pressable } from "@/shared/ui";
import { settingSearchEntries } from "../profiles/registry";
import { settingsPage, settingsPageTitle, settingsRegistry } from "../settingsRegistry";
import type { SettingsSection } from "../settingsTypes";
export interface SettingsSearchResult {
  key: string;
  label: string;
  page: SettingsSection;
  /** The row to focus once the page opens; empty for whole-page matches. */
  focus: string;
}
export function searchSettings(query: string): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const rows = settingSearchEntries
    .filter((d) => settingsPage(d.page as SettingsSection))
    .filter((d) =>
      `${d.label} ${d.id} ${d.page} ${d.keywords?.join(" ") ?? ""}`.toLowerCase().includes(needle),
    )
    .map((d) => ({
      key: d.id,
      label: d.label,
      page: [
        "browser.privacy.page_state_restore",
        "browser.privacy.page_state_agent_restore",
      ].includes(d.id)
        ? ("sync" as const)
        : (d.page as SettingsSection),
      focus: d.label,
    }));
  const pages = settingsRegistry
    .filter((p) => settingsPageTitle(p).toLowerCase().includes(needle))
    .map((p) => ({ key: `page:${p.id}`, label: settingsPageTitle(p), page: p.id, focus: "" }));
  return [...pages, ...rows];
}
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || !query.trim()) return <>{text}</>;
  const end = at + query.trim().length;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-charcoal-active text-cream-bright">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </>
  );
}
/** Replaces the section list while the user types in the settings search box. */
export function SettingsSearchResults(props: {
  query: string;
  results: SettingsSearchResult[];
  onSelect: (result: SettingsSearchResult) => void;
}) {
  return (
    <div
      aria-label="Settings search results"
      className="misty-scrollbar grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-3 [scrollbar-gutter:stable] max-[680px]:px-2"
    >
      {props.results.map((result) => {
        const page = settingsPage(result.page)!;
        return (
          <Pressable
            key={result.key}
            className="grid gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-charcoal-hover focus-visible:bg-charcoal-hover"
            onClick={() => props.onSelect(result)}
          >
            <span className="truncate text-[13px] text-cream">
              <Highlighted text={result.label} query={props.query} />
            </span>
            {result.focus ? (
              <span className="truncate text-[11px] text-cream-muted">
                {settingsPageTitle(page).replace(" / ", " › ")}
              </span>
            ) : null}
          </Pressable>
        );
      })}
      {!props.results.length ? (
        <p className="px-2.5 py-1.5 text-xs text-cream-muted">
          No settings match “{props.query.trim()}”
        </p>
      ) : null}
    </div>
  );
}
