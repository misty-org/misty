import { Bot, FolderOpen, PanelLeft, Pin, Search, SquareTerminal } from "lucide-react";
import { useCallback, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  dockLeaves,
  codeTabActiveFilePath,
  parseCodeTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { ShortcutHint } from "@/features/shortcuts";
import type { CodeCommand, CommandCenterMode } from "./components/CodeCommandCenter";

export function useCodeCommands(
  codeTab: WorkspaceTab | undefined,
  setCommandMode: Dispatch<SetStateAction<CommandCenterMode | null>>,
  toggleTerminal: () => void,
) {
  const openModelsSettings = useCallback(
    () =>
      window.dispatchEvent(
        new CustomEvent("misty:open-settings", { detail: { section: "models" } }),
      ),
    [],
  );
  const commands = useMemo<CodeCommand[]>(
    () => [
      command("files", "Open file", "code.quick_open", <FolderOpen size={13} />, () =>
        setCommandMode("files"),
      ),
      command(
        "toggle-files",
        "Toggle Explorer",
        "code.toggle_explorer",
        <PanelLeft size={13} />,
        () => {
          if (codeTab) useWorkspaceStore.getState().toggleSidebar(codeTab.id);
        },
      ),
      command("harpoon", "Harpoon marks and recents", "code.harpoon", <Pin size={13} />, () =>
        setCommandMode("harpoon"),
      ),
      command("search", "Search project", "code.search_project", <Search size={13} />, () =>
        setCommandMode("search"),
      ),
      command(
        "terminal",
        "Toggle Terminal",
        "code.toggle_terminal",
        <SquareTerminal size={13} />,
        toggleTerminal,
      ),
      command("ai", "AI and model settings", null, <Bot size={13} />, openModelsSettings),
    ],
    [codeTab, openModelsSettings, setCommandMode, toggleTerminal],
  );
  return { commands, openModelsSettings };
}

function command(
  id: string,
  label: string,
  shortcutCommandId: string | null,
  icon: ReactNode,
  run: () => void,
): CodeCommand {
  return { id, label, shortcutCommandId: shortcutCommandId ?? undefined, icon, run };
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
          Open a file with <ShortcutHint commandId="code.quick_open" />
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
      const activeFilePath = codeTabActiveFilePath(candidate);
      return activeFilePath !== path && basename(activeFilePath ?? "") === name;
    });
  if (!duplicate) return name;
  const relative = path.slice(root.length).replace(/^\//, "");
  const parts = relative.split("/");
  return parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
}

export function languageOf(name: string | undefined) {
  return name?.split(".").pop()?.toLowerCase() ?? "";
}
