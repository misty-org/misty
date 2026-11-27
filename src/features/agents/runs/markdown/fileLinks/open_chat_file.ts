// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { useContextPanel } from "../../../context-panel/context_panel_store";
import { useFilesStore } from "../../../context-panel/files/files_store";
import { useMistyStore } from "../../../conversations/state/use_misty_store";
import { useChatFolder } from "../../../shared-folders/chat_folder";
import { agentAccountId } from "../../../personal/agent_account";
import { resolveChatFileLink } from "./file_link_resolution";
import { notify } from "@misty/ui";

export function useReplyFolder(): string {
  const conversationId = useMistyStore((state) => state.activeConversationId);
  return useChatFolder(conversationId).folder;
}

export function openChatFilePath(rawPath: string, folder: string): void {
  void resolveChatFileLink(rawPath, folder).then((path) => {
    if (!path) return;
    void useFilesStore.getState().openFile(path);
    useContextPanel.getState().show("files");
  });
}

export function revealChatFilePath(rawPath: string, folder: string): void {
  void resolveChatFileLink(rawPath, folder).then((path) => {
    if (!path) {
      notify({ message: "Couldn't find that file. It may have moved.", tone: "error" });
      return;
    }
    void invoke("project_reveal_path", { account: agentAccountId(), path }).catch(() =>
      notify({ message: "Couldn't show the file. It may have moved.", tone: "error" }),
    );
  });
}

export function copyChatFilePath(rawPath: string, folder: string): void {
  void resolveChatFileLink(rawPath, folder).then((path) => {
    const value = path ?? rawPath;
    const link = value.startsWith("/") ? `file://${encodeURI(value)}` : value;
    void navigator.clipboard.writeText(link).then(
      () => notify({ message: "Path copied" }),
      () => notify({ message: "Couldn't copy the path.", tone: "error" }),
    );
  });
}
