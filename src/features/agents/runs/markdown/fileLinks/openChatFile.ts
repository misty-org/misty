// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { useContextPanel } from "../../../context-panel/contextPanelStore";
import { useFilesStore } from "../../../context-panel/files/filesStore";
import { currentSpaceKey, folderOf, useSpaceFolders } from "../../../engines/enginesApi";
import { agentAccountId } from "../../../personal/agentAccount";
import { resolveChatFileLink } from "./fileLinkResolution";

/** The folder this window's chats work in, which relative links in replies are anchored at. */
export function useChatFolder(): string {
  return useSpaceFolders((state) => folderOf(state, currentSpaceKey())) ?? "";
}

/**
 * Opens a path a reply names in the editor beside the chat. Resolving is async on purpose: a path
 * that only exists further down the folder is found by its name instead of opening a missing
 * file. A path that isn't one resolves to nothing, and nothing happens.
 */
export function openChatFilePath(rawPath: string, folder: string): void {
  void resolveChatFileLink(rawPath, folder).then((path) => {
    if (!path) return;
    void useFilesStore.getState().openFile(path);
    useContextPanel.getState().show("files");
  });
}

/** Shows the file in Finder (or the system's file manager); native code checks it is in a
 * folder this account linked. */
export function revealChatFilePath(rawPath: string, folder: string): void {
  void resolveChatFileLink(rawPath, folder).then((path) => {
    if (path)
      void invoke("project_reveal_path", { account: agentAccountId(), path }).catch(
        () => undefined,
      );
  });
}

/** Copies the path, as a `file://` link when it is absolute. */
export function copyChatFilePath(rawPath: string, folder: string): void {
  void resolveChatFileLink(rawPath, folder).then((path) => {
    const value = path ?? rawPath;
    const link = value.startsWith("/") ? `file://${encodeURI(value)}` : value;
    void navigator.clipboard.writeText(link).catch(() => undefined);
  });
}
