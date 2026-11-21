// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import type { KeyboardEvent } from "react";
import { isMac } from "./keyLabels";

/** What Finder's keys do here; each is optional, so a mode leaves out what it doesn't offer. */
export interface FilesKeyCommands {
  /** The items in the order they show, and how many sit in one row of the grid (1 for a list). */
  order(): { ids: string[]; perRow: number };
  selected: readonly string[];
  move(delta: number, extend: boolean): void;
  selectAll(): void;
  typeSelect(text: string): void;
  open(): void;
  up(): void;
  back(): void;
  forward(): void;
  quickLook(): void;
  info(): void;
  rename?(): void;
  duplicate?(): void;
  copy?(): void;
  cut?(): void;
  paste?(): void;
  copyPath(): void;
  reveal(): void;
  trash?(): void;
  deleteNow?(): void;
  newFolder?(): void;
  undo?(): void;
  redo?(): void;
  search(): void;
  toggleHidden?(): void;
  view(which: "grid" | "list" | "columns"): void;
  goTo?(place: "home" | "desktop" | "documents" | "downloads" | "applications"): void;
  /** Go to Folder: a path typed in a dialog. */
  goToFolder?(): void;
  clear(): void;
}

const typed = { text: "", at: 0 };
const TYPE_SELECT_MS = 1000;

/**
 * Finder's keys for the open folder: arrows (⇧ extends), Home and End, ⌘A, ⌘↓ or ⌘O to open, ⌘↑ for the
 * enclosing folder, Return to rename (Enter opens elsewhere), Space for Quick Look, typing to jump to a
 * name, and the commands' own chords. Columns move with their own keys (ColumnBrowser).
 */
export function handleFilesKey(event: KeyboardEvent<HTMLElement>, commands: FilesKeyCommands, columns: boolean) {
  if (event.defaultPrevented) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable='true'], [role='menu']")) return;
  const primary = isMac ? event.metaKey : event.ctrlKey;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const run = (command: (() => void) | undefined) => {
    if (!command) return;
    event.preventDefault();
    command();
  };

  if (primary) {
    if (event.altKey) {
      if (lower === "c") return run(commands.copyPath);
      if (key === "Backspace") return run(commands.deleteNow);
      if (lower === "l") return run(commands.goTo && (() => commands.goTo?.("downloads")));
      if (key === "1" || key === "2" || key === "3")
        return run(() => commands.view(key === "1" ? "grid" : key === "2" ? "list" : "columns"));
      return;
    }
    if (event.shiftKey) {
      if (lower === "n") return run(commands.newFolder);
      if (lower === "g") return run(commands.goToFolder);
      if (lower === "z") return run(commands.redo);
      if (key === "." || key === ">") return run(commands.toggleHidden);
      const places = { h: "home", d: "desktop", o: "documents", a: "applications" } as const;
      const place = places[lower as keyof typeof places];
      if (place) return run(commands.goTo && (() => commands.goTo?.(place)));
      return;
    }
    if (key === "ArrowUp") return run(commands.up);
    if (key === "ArrowDown" || lower === "o") return run(commands.open);
    if (key === "[") return run(commands.back);
    if (key === "]") return run(commands.forward);
    if (key === "Backspace") return run(commands.trash);
    const chords: Record<string, (() => void) | undefined> = {
      a: commands.selectAll,
      i: commands.info,
      y: commands.quickLook,
      d: commands.duplicate,
      c: commands.copy,
      x: commands.cut,
      v: commands.paste,
      r: commands.reveal,
      z: commands.undo,
      f: commands.search,
    };
    if (!isMac && lower === "y") return run(commands.redo);
    return run(chords[lower]);
  }
  if (event.altKey && !isMac) {
    if (key === "ArrowLeft") return run(commands.back);
    if (key === "ArrowRight") return run(commands.forward);
    if (key === "ArrowUp") return run(commands.up);
    if (key === "Enter") return run(commands.info);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (!isMac && key === "Delete") return run(event.shiftKey ? commands.deleteNow : commands.trash);
  if (key === "F2") return run(commands.rename);
  if (key === "Escape") return run(commands.clear);

  // Typing jumps to the first name that starts with what was typed; Space goes on a name being typed.
  const typing = event.timeStamp - typed.at < TYPE_SELECT_MS && typed.text !== "";
  if (key.length === 1 && (key !== " " || typing)) {
    typed.text = (typing ? typed.text : "") + key.toLocaleLowerCase();
    typed.at = event.timeStamp;
    return run(() => commands.typeSelect(typed.text));
  }
  if (key === " ") return run(commands.selected.length === 1 ? commands.quickLook : undefined);
  if (key === "Enter") {
    if (!commands.selected.length) return;
    return run(isMac && commands.selected.length === 1 ? commands.rename : commands.open);
  }
  if (columns) return;

  const { ids, perRow } = commands.order();
  if (!ids.length) return;
  const delta =
    key === "ArrowDown"
      ? perRow
      : key === "ArrowUp"
        ? -perRow
        : key === "ArrowRight" && perRow > 1
          ? 1
          : key === "ArrowLeft" && perRow > 1
            ? -1
            : key === "Home"
              ? -ids.length
              : key === "End"
                ? ids.length
                : 0;
  if (delta) run(() => commands.move(delta, event.shiftKey));
}

/**
 * The items in the order they show on screen (the table may be sorted by a header) and how many sit in
 * a row of the grid, read from the rendered rows and cards, which name themselves by their titles.
 */
export function shownOrder(container: HTMLElement | null, items: { id: string; name: string }[]) {
  const fallback = { ids: items.map((item) => item.id), perRow: 1 };
  if (!container) return fallback;
  const byName = new Map<string, string>();
  for (const item of items) if (!byName.has(item.name)) byName.set(item.name, item.id);
  const seen = new Set<string>();
  const shown: { id: string; top: number }[] = [];
  for (const element of Array.from(container.querySelectorAll<HTMLElement>("[aria-label]"))) {
    const id = byName.get(element.getAttribute("aria-label") ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    shown.push({ id, top: element.getBoundingClientRect().top });
  }
  if (shown.length !== items.length) return fallback;
  const perRow = Math.max(1, shown.filter((entry) => Math.abs(entry.top - shown[0].top) < 2).length);
  return { ids: shown.map((entry) => entry.id), perRow };
}
