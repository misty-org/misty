import { settingsString, useSettingsStore } from "./store/useSettingsStore";

/** Toolbar buttons a person may hide. Back and the browser menu always stay. */
export const optionalToolbarButtons = [
  { id: "forward", label: "Forward" },
  { id: "reload", label: "Reload" },
  { id: "site-info", label: "Site information" },
  { id: "bookmark", label: "Bookmark star" },
  { id: "misty", label: "Misty" },
  { id: "extensions", label: "Extensions" },
  { id: "downloads", label: "Downloads" },
] as const;

export type ToolbarButtonId = (typeof optionalToolbarButtons)[number]["id"];

export const toolbarHiddenKey = "browser_toolbar_hidden_json";

export function parseHiddenToolbarButtons(raw: string): Set<ToolbarButtonId> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const known = new Set<string>(optionalToolbarButtons.map((button) => button.id));
    return new Set(
      parsed.filter((id): id is ToolbarButtonId => typeof id === "string" && known.has(id)),
    );
  } catch {
    return new Set();
  }
}

/** The buttons hidden from the browser toolbar, as an account setting. */
export function useHiddenToolbarButtons(): Set<ToolbarButtonId> {
  const raw = useSettingsStore((state) =>
    settingsString(state.settings?.document ?? {}, "general", toolbarHiddenKey, "[]"),
  );
  return parseHiddenToolbarButtons(raw);
}
