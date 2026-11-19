import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Eye,
  EyeOff,
  FilePlus,
  FolderOpen,
  FolderPlus,
  LocateFixed,
  MoreHorizontal,
  RotateCw,
  SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
} from "@/shared/ui";
import { parentPath, useFilesStore } from "./filesStore";
import { useTreePreferences } from "./treePreferences";

const revealLabel = navigator.platform.includes("Mac")
  ? "Reveal in Finder"
  : navigator.platform.includes("Win")
    ? "Reveal in Explorer"
    : "Reveal in file manager";

/** What a page that shows the tree on its own (the Code page) adds over it. */
export interface FileTreeToolbarOptions {
  /** The row under the tools that names the folder, such as its picker. */
  heading?: ReactNode;
  /** Opens a terminal in the folder, when the page has one. */
  onOpenTerminal?(): void;
}

/**
 * The tree's own tools on a row of their own, above the folder's name, so a long name keeps the
 * whole width: new file and folder at the folder's top, reveal the open file, collapse all, and
 * the rest in ⋯. It stands in for the root row's hover tools where the page has room for it.
 */
export function FileTreeToolbar({
  root,
  options,
  onNewFile,
  onNewFolder,
  onReveal,
  onCopyPath,
}: {
  root: string;
  options: FileTreeToolbarOptions;
  onNewFile(dir: string): void;
  onNewFolder(dir: string): void;
  onReveal(path: string): void;
  onCopyPath(path: string): void;
}) {
  const active = useFilesStore((state) => state.activeFilePath);
  const refreshing = useFilesStore((state) => state.refreshing);
  const hideIgnored = useTreePreferences((state) => state.hideIgnored);

  const revealActive = () => {
    if (!active) return;
    const store = useFilesStore.getState();
    void store.revealDir(parentPath(active)).then(() => store.selectPath(active, false));
  };

  return (
    <>
      <div
        className="flex h-10 flex-none border-b items-center gap-1 px-2"
        role="toolbar"
        aria-label="Files"
      >
        <IconButton label="New file" onClick={() => onNewFile(root)}>
          <FilePlus aria-hidden />
        </IconButton>
        <IconButton label="New folder" onClick={() => onNewFolder(root)}>
          <FolderPlus aria-hidden />
        </IconButton>
        {active ? (
          <IconButton label="Reveal open file" onClick={revealActive}>
            <LocateFixed aria-hidden />
          </IconButton>
        ) : null}
        <IconButton
          label="Collapse all folders"
          hint="Collapse all folders (⌥⇧←)"
          aria-keyshortcuts="Alt+Shift+ArrowLeft"
          onClick={() => useFilesStore.getState().collapseAllDirs()}
        >
          <ChevronsDownUp aria-hidden />
        </IconButton>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More">
              <MoreHorizontal aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <MenuItem
              icon={ChevronsUpDown}
              label="Expand loaded folders"
              onSelect={() => useFilesStore.getState().expandLoadedDirs()}
            />
            <MenuItem
              icon={hideIgnored ? Eye : EyeOff}
              label={hideIgnored ? "Show ignored files" : "Hide ignored files"}
              onSelect={() =>
                void useTreePreferences
                  .getState()
                  .setHideIgnored(!hideIgnored)
                  .catch(() => undefined)
              }
            />
            <MenuItem
              icon={RotateCw}
              label="Refresh"
              disabled={refreshing}
              onSelect={() => void useFilesStore.getState().refreshTree()}
            />
            <DropdownMenuSeparator />
            <MenuItem icon={FolderOpen} label={revealLabel} onSelect={() => onReveal(root)} />
            <MenuItem icon={Copy} label="Copy path" onSelect={() => onCopyPath(root)} />
            {options.onOpenTerminal ? (
              <MenuItem
                icon={SquareTerminal}
                label="Open in terminal"
                onSelect={options.onOpenTerminal}
              />
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {options.heading ? (
        // The folder's name under the tools: the picker that changes it. The tree is the
        // sidebar's one section, so nothing folds it away.
        <div className="flex h-8 min-w-0 flex-none items-center px-2">{options.heading}</div>
      ) : null}
    </>
  );
}
