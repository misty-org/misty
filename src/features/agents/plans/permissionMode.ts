import { collaborationApi } from "./api";
import { useCollaborationStore } from "./store";
import type { ConversationCollaboration, PermissionMode } from "./planTypes";
import type { EngineModeOption } from "../engines/engineModes";

/**
 * The engine mode a chat saved: its own choice, else its agent's default. A new chat uses the
 * composer's draft choice, else the agent's default. An older saved Ask, Auto, Plan or Bypass is
 * mapped to the engine's own mode as it is read (`resolveEngineMode`); unknown asks first.
 */
export function effectivePermissionMode(
  state: ConversationCollaboration | undefined,
  draft: PermissionMode | "",
  agentDefault?: PermissionMode,
): PermissionMode {
  if (state) return state.permissionMode || state.agentPermissionMode || agentDefault || "ask";
  return draft || agentDefault || "ask";
}

/**
 * Chooses one of the engine's modes for the chat. Its planning mode also puts the chat in Plan,
 * and any other takes it out, so the plan card and Misty's own runtime read the same choice. A
 * Teach lesson keeps its mode.
 */
export async function chooseEngineMode(
  conversationId: string | undefined,
  mode: EngineModeOption,
  teaching = false,
) {
  await setPermissionMode(conversationId, mode.id);
  if (!teaching)
    await useCollaborationStore
      .getState()
      .setMode(conversationId, mode.kind === "plans" ? "plan" : "act");
}

/** Chooses the chat's engine mode. The next message uses it; a running turn keeps its own. */
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
    store.setState({ error: "Misty couldn't change this chat's mode. Try again." });
  }
}

/** The chat's saved engine mode for the composer, kept current with the store. */
export function usePermissionMode(conversationId?: string, agentDefault?: PermissionMode) {
  const state = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId] : undefined,
  );
  const draft = useCollaborationStore((s) => s.draftPermissionMode);
  return effectivePermissionMode(state, draft, agentDefault);
}

/**
 * The modes a turn sends. Plan or Act: a conversation's loaded mode, or the
 * composer's choice for a conversation that has no messages yet. The engine mode:
 * a new conversation sends the composer's choice. Unknown leaves the chat's
 * saved choice, or the agent's default.
 */
export function turnModes(conversationId: string, startsConversation: boolean) {
  const collaboration = useCollaborationStore.getState();
  const current = collaboration.byConversation[conversationId];
  const loaded = Boolean(current);
  // With the chat's state on this computer, its engine mode only travels with the turn.
  const own = current?.permissionMode || undefined;
  return {
    collaborationMode: loaded
      ? collaboration.modeFor(conversationId)
      : startsConversation
        ? collaboration.draftMode
        : undefined,
    permissionMode:
      own ??
      (!loaded && startsConversation ? collaboration.draftPermissionMode || undefined : undefined),
  };
}
