import { collaborationApi } from "./api";
import { useCollaborationStore } from "./store";
import type { ConversationCollaboration, PermissionMode } from "./plan_types";
import type { EngineModeOption } from "../engines/engine_modes";

export function effectivePermissionMode(
  state: ConversationCollaboration | undefined,
  draft: PermissionMode | "",
  agentDefault?: PermissionMode,
): PermissionMode {
  if (state) return state.permissionMode || state.agentPermissionMode || agentDefault || "ask";
  return draft || agentDefault || "ask";
}

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

export function usePermissionMode(conversationId?: string, agentDefault?: PermissionMode) {
  const state = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId] : undefined,
  );
  const draft = useCollaborationStore((s) => s.draftPermissionMode);
  return effectivePermissionMode(state, draft, agentDefault);
}

export function turnModes(conversationId: string, startsConversation: boolean) {
  const collaboration = useCollaborationStore.getState();
  const current = collaboration.byConversation[conversationId];
  const loaded = Boolean(current);
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
