// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  FileText,
  FolderOpen,
  Globe,
  Link2,
  MessageSquarePlus,
  Minus,
  Plus,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ContextMenu,
  MenuItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui";
import { useContextPanel } from "../contextPanelStore";
import { filesApi } from "../files/filesApi";
import { useFilesStore } from "../files/filesStore";
import { sendPathToComposer } from "../files/sendToComposer";
import type { GitFileEntry } from "./gitApi";

const HTML_RE = /\.(?:html?|xhtml)$/i;

/** `entry`'s path on disk, from the repository its row belonged to. */
export function absoluteOf(repository: string, relative: string) {
  return /[\\/]$/.test(repository) ? `${repository}${relative}` : `${repository}/${relative}`;
}

const isMac = () => typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const isWindows = () => typeof navigator !== "undefined" && navigator.platform.includes("Win");

export const revealLabel = () =>
  isMac() ? "Reveal in Finder" : isWindows() ? "Show in Explorer" : "Show in file manager";

/** Opens a changed file in the files panel's editor. */
export function openChangedFile(path: string) {
  void useFilesStore.getState().openFile(path);
  useContextPanel.getState().show("files");
}

/**
 * The right-click menu of a changed file's row: open it, stage or unstage it, throw its changes
 * away (after asking), copy its path, reveal it, mention it in the chat. Failures go through
 * `run`, the panel's own error line.
 */
export function ChangesFileMenu(props: {
  /** The linked folder the chat works in, for the mention's relative path. */
  folder: string;
  repository: string;
  entry: GitFileEntry;
  actionKind: "stage" | "unstage";
  onAction: (path: string) => void;
  onDiscard?: (path: string) => void;
  run: (key: string, action: () => Promise<unknown>) => void;
  children: ReactNode;
}) {
  const path = absoluteOf(props.repository, props.entry.path);
  const deleted = props.entry.status === "deleted";
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={props.entry.path} width="md">
        <MenuItem
          icon={FileText}
          label="Open file"
          disabled={deleted}
          onSelect={() => openChangedFile(path)}
        />
        {HTML_RE.test(path) ? (
          <MenuItem
            icon={Globe}
            label="Open in browser"
            disabled={deleted}
            onSelect={() => props.run("open-in-browser", () => filesApi.openInBrowser(path))}
          />
        ) : null}
        <ContextMenuSeparator />
        <MenuItem
          icon={props.actionKind === "stage" ? Plus : Minus}
          label={props.actionKind === "stage" ? "Stage" : "Unstage"}
          onSelect={() => props.onAction(props.entry.path)}
        />
        {props.onDiscard ? (
          <MenuItem
            icon={Undo2}
            label="Discard changes"
            danger
            onSelect={() => props.onDiscard?.(props.entry.path)}
          />
        ) : null}
        <ContextMenuSeparator />
        <MenuItem
          icon={Link2}
          label="Copy path"
          onSelect={() => props.run("copy-path", () => navigator.clipboard.writeText(path))}
        />
        <MenuItem
          icon={MessageSquarePlus}
          label="Send to chat"
          onSelect={() => sendPathToComposer(props.folder, path, false)}
        />
        <MenuItem
          icon={FolderOpen}
          label={revealLabel()}
          disabled={deleted}
          onSelect={() => props.run("reveal", () => filesApi.reveal(path))}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
