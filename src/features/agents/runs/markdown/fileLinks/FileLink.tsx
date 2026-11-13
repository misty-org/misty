// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { ReactNode } from "react";
import { FileText, FolderOpen, Link2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  Tooltip,
} from "@/shared/ui";
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
      <Tooltip content={resolved ?? path}>
        <ContextMenuTrigger asChild>
          <a
            className="misty-markdown-file-link"
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openChatFilePath(path, folder);
            }}
          >
            {children}
          </a>
        </ContextMenuTrigger>
      </Tooltip>
      <ContextMenuContent data-misty-layer-portal>
        <MenuItem
          icon={FileText}
          label="Open file"
          disabled={!resolved}
          onSelect={() => openChatFilePath(path, folder)}
        />
        <MenuItem
          icon={FolderOpen}
          label={revealLabel}
          disabled={!resolved}
          onSelect={() => revealChatFilePath(path, folder)}
        />
        <MenuItem icon={Link2} label="Copy path" onSelect={() => copyChatFilePath(path, folder)} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
