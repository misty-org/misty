import { collaborationApi } from "./api";
import { useCollaborationStore } from "./store";
import type { ConversationCollaboration, PermissionMode } from "./types";

/** The menu's choices, each with the one line that explains it. */
export const permissionModes: { id: PermissionMode; label: string; description: string }[] = [
  { id: "ask", label: "Ask", description: "Pauses before every change for your OK" },
  {
    id: "auto",
    label: "Auto",
    description: "Continues where you remembered an approval; asks for the rest",
  },
];

export const permissionModeLabel = (mode: PermissionMode) =>
  permissionModes.find((option) => option.id === mode)?.label ?? "Ask";

/**
 * Ask or Auto for a chat: its own choice, else its agent's default. A new chat
 * uses the composer's draft choice, else the agent's default. Unknown is Ask.
 */
export function effectivePermissionMode(
  state: ConversationCollaboration | undefined,
  draft: PermissionMode | "",
  agentDefault?: PermissionMode,
): PermissionMode {
  if (state) return state.permissionMode || state.agentPermissionMode || "ask";
  return draft || agentDefault || "ask";
}

/** Chooses Ask or Auto. The next message uses it; a running turn keeps its own. */
export async function setPermissionMode(conversationId: string | undefined, mode: PermissionMode) {
  const store = useCollaborationStore;
  if (!conversationId || !store.getState().byConversation[conversationId]) {
    store.setState({ draftPermissionMode: mode });
    return;
  }
  const patch = (permissionMode: PermissionMode | "") =>
    store.setState((state) => {
      const current = state.byConversation[conversationId];
      return current
        ? {
            byConversation: {
              ...state.byConversation,
              [conversationId]: { ...current, permissionMode },
            },
          }
        : {};
    });
  const previous = store.getState().byConversation[conversationId]?.permissionMode ?? "";
  patch(mode);
  try {
    await collaborationApi.setPermissionMode(conversationId, mode);
  } catch {
    patch(previous);
    store.setState({ error: "Misty couldn't change Ask or Auto for this chat. Try again." });
  }
}

/** Ask or Auto for the composer, kept current with the store. */
export function usePermissionMode(conversationId?: string, agentDefault?: PermissionMode) {
  const state = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId] : undefined,
  );
  const draft = useCollaborationStore((s) => s.draftPermissionMode);
  return effectivePermissionMode(state, draft, agentDefault);
}

/**
 * The modes a turn sends. Plan or Act: a conversation's loaded mode, or the
 * composer's choice for a conversation that has no messages yet. Ask or Auto:
 * a new conversation sends the composer's choice. Unknown leaves the server's
 * saved choice, or the agent's default.
 */
export function turnModes(conversationId: string, startsConversation: boolean) {
  const collaboration = useCollaborationStore.getState();
  const loaded = Boolean(collaboration.byConversation[conversationId]);
  return {
    collaborationMode: loaded
      ? collaboration.modeFor(conversationId)
      : startsConversation
        ? collaboration.draftMode
        : undefined,
    permissionMode:
      !loaded && startsConversation ? collaboration.draftPermissionMode || undefined : undefined,
  };
}
