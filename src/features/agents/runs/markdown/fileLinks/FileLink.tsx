// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { ReactNode } from "react";
import { FileText, FolderOpen, Link2 } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/shared/ui";
import { resolveFilePath } from "./fileLinks";
import {
  copyChatFilePath,
  openChatFilePath,
  revealChatFilePath,
  useChatFolder,
} from "./openChatFile";

const revealLabel =
  typeof navigator !== "undefined" && navigator.platform.includes("Mac")
    ? "Reveal in Finder"
    : typeof navigator !== "undefined" && navigator.platform.includes("Win")
      ? "Show in Explorer"
      : "Show in file manager";

/**
 * A file path in a reply: a click opens it in the editor beside the chat, and right-click offers
 * to open it, show it in the file manager or copy its path. Failures are quiet, as a missing file
 * isn't worth an error in the transcript.
 */
export function FileLink({
  href,
  path,
  children,
}: {
  href: string;
  path: string;
  children: ReactNode;
}) {
  const folder = useChatFolder();
  const resolved = resolveFilePath(path, folder);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          className="misty-markdown-file-link"
          href={href}
          title={resolved ?? path}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openChatFilePath(path, folder);
          }}
        >
          {children}
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent data-misty-layer-portal>
        <ContextMenuItem disabled={!resolved} onSelect={() => openChatFilePath(path, folder)}>
          <FileText aria-hidden="true" />
          Open file
        </ContextMenuItem>
        <ContextMenuItem disabled={!resolved} onSelect={() => revealChatFilePath(path, folder)}>
          <FolderOpen aria-hidden="true" />
          {revealLabel}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyChatFilePath(path, folder)}>
          <Link2 aria-hidden="true" />
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
