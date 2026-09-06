import { Checkbox, SkeletonList, cn } from "@/shared/ui";
import { enter } from "./ImportSourceList";
import type { ImportKind } from "./runImport";
import type { ImportPreview, ImportSettingKind } from "./native";

const settingNames: Record<ImportSettingKind, string> = {
  searchEngine: "search engine",
  homepage: "homepage",
  startup: "startup",
  sitePermissions: "camera and microphone choices",
};
const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export interface ReviewRow {
  kind: ImportKind;
  label: string;
  detail: string;
  available: boolean;
}

/** One row per kind, saying what will come across or why it can't. */
export function reviewRows(preview: ImportPreview, keychainPrompt: boolean): ReviewRow[] {
  const { bookmarks, history, signins } = preview;
  const settings = preview.settings.map((kind) => settingNames[kind]);
  return [
    {
      kind: "bookmarks",
      label: "Bookmarks",
      available: Boolean(bookmarks.value?.links || bookmarks.value?.folders),
      detail: bookmarks.value
        ? bookmarks.value.links || bookmarks.value.folders
          ? `${count(bookmarks.value.links, "bookmark")} in ${count(bookmarks.value.folders, "folder")}, kept in the same places.`
          : "No bookmarks yet."
        : (bookmarks.issue ?? "Not available."),
    },
    {
      kind: "history",
      label: "History",
      available: Boolean(history.value),
      detail: history.value
        ? `${count(history.value, "visit")}, with their original times.`
        : (history.issue ?? "No history yet."),
    },
    {
      kind: "settings",
      label: "Settings",
      available: settings.length > 0,
      detail: settings.length
        ? `${settings.join(", ").replace(/^./, (c) => c.toUpperCase())}.`
        : "Nothing Misty has a match for.",
    },
    {
      kind: "signins",
      label: "Signed-in sites",
      available: Boolean(signins.value),
      detail: signins.value
        ? `Stay signed in on ${count(signins.value, "site")}.${keychainPrompt ? " Your Mac asks you to allow this first." : ""}`
        : (signins.issue ?? "No saved sign-ins."),
    },
    {
      kind: "extensions",
      label: "Extensions",
      available: preview.extensions.length > 0,
      detail: preview.extensions.length
        ? `${count(preview.extensions.length, "extension")} to find in Misty's catalog.`
        : "No extensions to bring across.",
    },
  ];
}

export function ImportReview(props: {
  rows: ReviewRow[] | null;
  chosen: Set<ImportKind>;
  onToggle(kind: ImportKind, on: boolean): void;
}) {
  if (!props.rows)
    return <SkeletonList label="Checking what this browser has" rows={5} leading="none" />;
  return (
    <ul className="grid gap-1" aria-label="What to import">
      {props.rows.map((row, index) => {
        const id = `browser-import-${row.kind}`;
        return (
          <li
            key={row.kind}
            className={cn("flex items-start gap-3 rounded-md px-2 py-2", enter)}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <Checkbox
              id={id}
              className="mt-0.5"
              disabled={!row.available}
              checked={row.available && props.chosen.has(row.kind)}
              onCheckedChange={(value) => props.onToggle(row.kind, value === true)}
            />
            <label htmlFor={id} className="grid min-w-0 gap-0.5">
              <span
                className={row.available ? "text-sm text-cream-bright" : "text-sm text-cream-muted"}
              >
                {row.label}
              </span>
              <span className="text-xs text-cream-muted">{row.detail}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
