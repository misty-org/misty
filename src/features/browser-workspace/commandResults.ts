import { invokeShortcutCommand, shortcutCommandRegistry } from "@/features/shortcuts";
import { launchSiteApp } from "@/features/bookmarks/siteApps";
import { appsId, bookmarkTree } from "@/features/bookmarks/tree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import type { ScopedSearchResult } from "./scopedSearchSources";

/** The search box itself and keys that only make sense inside it. */
const hidden = new Set(["search.toggle", "app.command_palette"]);
const limit = 3;

/**
 * Browser and app commands whose name or aliases match what was typed, so the
 * address bar can also run them (pin a tab, split, open settings). Each runs
 * once the search box has closed.
 */
export function searchCommands(query: string): ScopedSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const words = (text: string) => text.toLocaleLowerCase().split(/[\s/-]+/);
  return shortcutCommandRegistry
    .filter((command) => !hidden.has(command.id) && !command.id.startsWith("search."))
    .map((command) => {
      const label = command.label.toLocaleLowerCase();
      const score = label.startsWith(needle)
        ? 3
        : words(label).some((word) => word.startsWith(needle))
          ? 2
          : command.aliases.some((alias) => alias.toLocaleLowerCase().startsWith(needle))
            ? 1
            : 0;
      return { command, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .slice(0, limit)
    .map(({ command }) => ({
      id: `command:${command.id}`,
      kind: "action" as const,
      title: command.label,
      subtitle: command.category,
      target: {
        kind: "run" as const,
        run: () => {
          window.setTimeout(() => invokeShortcutCommand(command.id), 0);
        },
      },
    }));
}

/** Installed site apps whose name or address matches, opened in their own window. */
export function searchSiteApps(query: string): ScopedSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const state = useWorkspaceStore.getState();
  return bookmarkTree(state.bookmarkFolders, state.bookmarks)
    .children(appsId)
    .flatMap((node) => (node.kind === "bookmark" ? [node] : []))
    .filter((app) => `${app.title} ${app.url}`.toLocaleLowerCase().includes(needle))
    .slice(0, limit)
    .map((app) => ({
      id: `app:${app.id}`,
      kind: "action" as const,
      title: `Open ${app.title}`,
      subtitle: "App",
      target: {
        kind: "run" as const,
        run: () => {
          launchSiteApp(app);
          window.dispatchEvent(new Event("misty:workspace-projection-applied"));
        },
      },
    }));
}
