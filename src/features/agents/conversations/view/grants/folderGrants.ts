// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../../personal/agentAccount";
import { currentSpaceKey, useSpaceFolders } from "../../../engines/enginesApi";
import type { AiInvocationEvent } from "../../../runs/invocations/invocationTypes";
import type { FolderGrant } from "../../state/conversationTypes";
import { useMistyStore } from "../../state/useMistyStore";

type Denial = Extract<AiInvocationEvent, { type: "permission.denied" }>;

/**
 * Adds a refusal to a reply's grants. An engine repeats a turn's refusals when it ends, and the
 * copy can differ in path and text: the same call is the same refusal, even after the person
 * declined it, and the same path is too while it is still open.
 */
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

/** Changes one grant on a reply in the store; the chat keeps it on this device. */
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

/** The folder allowing `path` would cover, worked out natively from the path's text alone. */
export const folderGrantScope = (path: string) =>
  invoke<string>("space_folder_grant_scope", { path });

/**
 * Asks native code to allow the folder `path` is in for this Space. Native code asks the person
 * in a system dialog and links the folder only if they agree; nothing here can say yes for them.
 * Resolves to the folder linked, or null when they declined.
 */
export async function requestFolderGrant(path: string): Promise<string | null> {
  const space = currentSpaceKey();
  const folder = await invoke<string | null>("space_folder_grant", {
    account: agentAccountId(),
    space,
    path,
  });
  if (folder)
    await useSpaceFolders
      .getState()
      .load(space)
      .catch(() => undefined);
  return folder;
}
