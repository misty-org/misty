import { Blocks, Bot, FolderOpen, PanelLeft, Pin, Search, SquareTerminal } from "lucide-react";
import { useCallback, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import {
  dockLeaves,
  parseCodeTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { shortcutMatchesEvent, type ShortcutMap } from "@/shared/lib/shortcuts";
import type { CodeCommand, CommandCenterMode } from "./components/CodeCommandCenter";

export function useCodeCommands(
  codeTab: WorkspaceTab | undefined,
  setCommandMode: Dispatch<SetStateAction<CommandCenterMode | null>>,
  toggleTerminal: () => void,
) {
  const navigate = useNavigate();
  const openExtensions = useCallback(() => {
    const workspace = useWorkspaceStore.getState();
    const opened = workspace.openSurface({
      surfaceId: "extensions",
      groupKey: "tool:extensions",
      title: "Extensions",
      route: "/extensions",
      instancePolicy: "single",
    });
    workspace.focusTab(opened.id);
    navigate(opened.route);
  }, [navigate]);
  const openModelsSettings = useCallback(
    () =>
      window.dispatchEvent(
        new CustomEvent("misty:open-settings", { detail: { section: "models" } }),
      ),
    [],
  );
  const commands = useMemo<CodeCommand[]>(
    () => [
      command("files", "Open file", "⌘P", <FolderOpen size={13} />, () => setCommandMode("files")),
      command("toggle-files", "Toggle Explorer", "⌘B", <PanelLeft size={13} />, () => {
        if (codeTab) useWorkspaceStore.getState().toggleSidebar(codeTab.id);
      }),
      command("harpoon", "Harpoon marks and recents", "Ctrl+E", <Pin size={13} />, () =>
        setCommandMode("harpoon"),
      ),
      command("search", "Search project", "⌘⇧F", <Search size={13} />, () =>
        setCommandMode("search"),
      ),
      command("terminal", "Toggle Terminal", "⌘J", <SquareTerminal size={13} />, toggleTerminal),
      command("ai", "AI and model settings", undefined, <Bot size={13} />, openModelsSettings),
      command("extensions", "Open Extensions", undefined, <Blocks size={13} />, openExtensions),
    ],
    [codeTab, openExtensions, openModelsSettings, setCommandMode, toggleTerminal],
  );
  return { commands, openExtensions, openModelsSettings };
}

function command(
  id: string,
  label: string,
  shortcut: string | undefined,
  icon: ReactNode,
  run: () => void,
): CodeCommand {
  return { id, label, shortcut, icon, run };
}

export function EmptyEditor({ rootPath, onOpen }: { rootPath: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid h-full w-full place-items-center bg-charcoal-bg text-center text-sm text-cream-muted"
    >
      <span>
        <span className="block">
          Open a file with <kbd className="font-mono text-cream">⌘P</kbd>
        </span>
        <span className="mt-2 block max-w-md truncate font-mono text-xs text-cream-muted/70">
          {rootPath}
        </span>
      </span>
    </button>
  );
}

export function isOwnedTerminal(tab: WorkspaceTab, codeTabId: string) {
  const state = tab.state as { owner?: unknown; codeTabId?: unknown } | null;
  return tab.surfaceId === "terminal" && state?.owner === "code" && state.codeTabId === codeTabId;
}

export function basename(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function displayFileTitle(path: string, root: string, currentTabId?: string) {
  const name = basename(path);
  const workspace = useWorkspaceStore.getState();
  const duplicate = dockLeaves(workspace.layout.root)
    .flatMap((pane) => pane.tabs)
    .find((tab) => {
      if (tab.id === currentTabId || tab.surfaceId !== "code") return false;
      const candidate = parseCodeTabState(tab.state);
      return candidate.activeFilePath !== path && basename(candidate.activeFilePath ?? "") === name;
    });
  if (!duplicate) return name;
  const relative = path.slice(root.length).replace(/^\//, "");
  const parts = relative.split("/");
  return parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
}

export function languageOf(name: string | undefined) {
  return name?.split(".").pop()?.toLowerCase() ?? "";
}

const CODE_COMMAND_IDS = [
  "code.quick_open",
  "code.command_palette",
  "code.search_project",
  "code.harpoon",
  "code.previous_file",
  "code.toggle_explorer",
  "code.toggle_terminal",
  "code.mark_1",
  "code.mark_2",
  "code.mark_3",
  "code.mark_4",
] as const;

export function codeCommandForEvent(event: KeyboardEvent, shortcuts: ShortcutMap) {
  return CODE_COMMAND_IDS.find((id) => shortcutMatchesEvent(shortcuts[id], event)) ?? null;
}

export function defaultCodeShortcuts(): ShortcutMap {
  const primary = /mac|iphone|ipad|ipod/i.test(navigator.platform) ? "Cmd" : "Ctrl";
  return {
    "code.quick_open": `${primary}+P`,
    "code.command_palette": `${primary}+Shift+P`,
    "code.search_project": `${primary}+Shift+F`,
    "code.harpoon": "Ctrl+E",
    "code.previous_file": "Ctrl+O",
    "code.toggle_explorer": `${primary}+B`,
    "code.toggle_terminal": `${primary}+J`,
    "code.mark_1": "Alt+1",
    "code.mark_2": "Alt+2",
    "code.mark_3": "Alt+3",
    "code.mark_4": "Alt+4",
  };
}
