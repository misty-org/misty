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
  ContextMenuAction,
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
        <ContextMenuAction
          icon={<FileText className="size-4" />}
          label="Open file"
          disabled={deleted}
          onSelect={() => openChangedFile(path)}
        />
        {HTML_RE.test(path) ? (
          <ContextMenuAction
            icon={<Globe className="size-4" />}
            label="Open in browser"
            disabled={deleted}
            onSelect={() => props.run("open-in-browser", () => filesApi.openInBrowser(path))}
          />
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuAction
          icon={
            props.actionKind === "stage" ? (
              <Plus className="size-4" />
            ) : (
              <Minus className="size-4" />
            )
          }
          label={props.actionKind === "stage" ? "Stage" : "Unstage"}
          onSelect={() => props.onAction(props.entry.path)}
        />
        {props.onDiscard ? (
          <ContextMenuAction
            icon={<Undo2 className="size-4" />}
            label="Discard changes"
            destructive
            onSelect={() => props.onDiscard?.(props.entry.path)}
          />
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuAction
          icon={<Link2 className="size-4" />}
          label="Copy path"
          onSelect={() => props.run("copy-path", () => navigator.clipboard.writeText(path))}
        />
        <ContextMenuAction
          icon={<MessageSquarePlus className="size-4" />}
          label="Send to chat"
          onSelect={() => sendPathToComposer(props.folder, path, false)}
        />
        <ContextMenuAction
          icon={<FolderOpen className="size-4" />}
          label={revealLabel()}
          disabled={deleted}
          onSelect={() => props.run("reveal", () => filesApi.reveal(path))}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
