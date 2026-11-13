// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { Terminal } from "@xterm/xterm";
import { ClipboardPaste, Copy, Eraser, FileText, FolderOpen, TextSelect, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  ContextMenu,
  MenuItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui";
import { isMacPlatform, isPathUnder, probePath } from "./links";
import { openTerminalPath, resolveTerminalPath } from "./openTarget";
import { filesApi } from "../files/filesApi";

const revealLabel = () =>
  isMacPlatform()
    ? "Reveal in Finder"
    : navigator.platform.includes("Win")
      ? "Show in Explorer"
      : "Show in file manager";

/**
 * The terminal's right-click menu: copy, paste, select all and clear, then, when the selection
 * is a path in the folder, opening it in the editor or showing it in Finder, and closing the tab.
 * The path rows show at once and stay disabled until the probe confirms the path, so the menu
 * never changes shape under the pointer. Paths outside the folder are never probed.
 */
export function TerminalContextMenu({
  getTerminal,
  cwd,
  onCloseTab,
  children,
}: {
  getTerminal: () => Terminal | null;
  cwd: string;
  onCloseTab: () => void;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState("");
  const [target, setTarget] = useState<{ path: string; isDir: boolean } | null | undefined>(
    undefined,
  );
  const resolved = selection ? resolveTerminalPath(selection, cwd) : null;
  const inside = resolved !== null && isPathUnder(resolved, cwd);

  useEffect(() => {
    let cancelled = false;
    setTarget(undefined);
    if (!resolved || !inside) return;
    void probePath(resolved).then((found) => {
      if (!cancelled) setTarget(found ? { path: resolved, isDir: found.isDir } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [resolved, inside]);

  const term = () => getTerminal();

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setSelection(getTerminal()?.getSelection() ?? "");
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent width="sm">
        <MenuItem
          icon={Copy}
          label="Copy"
          disabled={!selection}
          onSelect={() => void navigator.clipboard.writeText(selection).catch(() => undefined)}
        />
        <MenuItem
          icon={ClipboardPaste}
          label="Paste"
          onSelect={() =>
            void navigator.clipboard
              .readText()
              .then((text) => {
                const live = term();
                if (text && live) {
                  live.paste(text);
                  live.focus();
                }
              })
              .catch(() => undefined)
          }
        />
        <MenuItem icon={TextSelect} label="Select all" onSelect={() => term()?.selectAll()} />
        <MenuItem icon={Eraser} label="Clear" onSelect={() => term()?.clear()} />
        {resolved && inside ? (
          <>
            <ContextMenuSeparator />
            {target?.isDir ? null : (
              <MenuItem
                icon={FileText}
                label="Open in editor"
                disabled={!target}
                onSelect={() => target && openTerminalPath(target)}
              />
            )}
            <MenuItem
              icon={FolderOpen}
              label={revealLabel()}
              disabled={!target}
              onSelect={() => target && void filesApi.reveal(target.path).catch(() => undefined)}
            />
          </>
        ) : null}
        <ContextMenuSeparator />
        <MenuItem icon={X} label="Close terminal" danger onSelect={onCloseTab} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
