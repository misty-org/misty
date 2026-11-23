// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../../personal/agent_account";
import { currentSpaceKey } from "../../../engines/engines_api";
import { useChatFolders } from "../../../shared-folders/chat_folder";
import type { AiInvocationEvent } from "../../../runs/invocations/invocation_types";
import type { FolderGrant } from "../../state/conversation_types";
import { useMistyStore } from "../../state/use_misty_store";

type Denial = Extract<AiInvocationEvent, { type: "permission.denied" }>;

export function withDeniedFolder(grants: FolderGrant[] | undefined, event: Denial): FolderGrant[] {
  const list = grants ?? [];
  const path = event.path?.trim() || undefined;
  const message = event.message.trim();
  const toolCallId = event.toolCallId?.trim() || undefined;
  const duplicate = list.some(
    (grant) =>
      (toolCallId !== undefined && grant.toolCallId === toolCallId) ||
      ((path ? grant.path === path : grant.message === message) && grant.status !== "declined"),
  );
  if (duplicate) return list;
  return [
    ...list,
    {
      id: event.id,
      path,
      message,
      toolCallId,
      toolName: event.toolName,
      status: "pending",
    },
  ];
}

export function patchFolderGrant(
  conversationId: string,
  messageId: string,
  grantId: string,
  patch: Partial<FolderGrant>,
) {
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id !== conversationId
        ? conversation
        : {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id !== messageId
                ? message
                : {
                    ...message,
                    folderGrants: message.folderGrants?.map((grant) =>
                      grant.id === grantId ? { ...grant, ...patch } : grant,
                    ),
                  },
            ),
          },
    ),
  }));
}

export const folderGrantScope = (path: string) =>
  invoke<string>("space_folder_grant_scope", { path });

export async function requestFolderGrant(path: string): Promise<string | null> {
  const space = currentSpaceKey();
  const folder = await invoke<string | null>("space_folder_grant", {
    account: agentAccountId(),
    space,
    path,
  });
  if (folder)
    await useChatFolders
      .getState()
      .loadProjects()
      .catch(() => undefined);
  return folder;
}
