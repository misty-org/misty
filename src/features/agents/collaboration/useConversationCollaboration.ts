import { useEffect } from "react";
import { resolveSetting, useSettingsProfiles } from "@/features/settings";
import { useCollaborationStore } from "./store";
import type { ConversationCollaboration, ConversationMode } from "./types";

/**
 * A conversation's collaboration state (mode, plan, goal, questions), loaded
 * when it opens and kept current by its invocation events. Without a
 * conversation it reports the composer's draft mode.
 */
export function useConversationCollaboration(accountId: string, conversationId?: string) {
  useEffect(() => {
    useCollaborationStore.getState().setAccount(accountId);
  }, [accountId]);
  // New conversations start in the account's chosen mode.
  const profile = useSettingsProfiles((s) => s.state);
  const defaultMode =
    profile && resolveSetting(profile, "agents.collaboration_mode").value === "plan"
      ? "plan"
      : "act";
  useEffect(() => {
    useCollaborationStore.getState().setDefaultMode(defaultMode);
  }, [defaultMode]);
  useEffect(() => {
    if (accountId && conversationId) void useCollaborationStore.getState().load(conversationId);
  }, [accountId, conversationId]);
  const state = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId] : undefined,
  ) as ConversationCollaboration | undefined;
  const draftMode = useCollaborationStore((s) => s.draftMode);
  const mode: ConversationMode = conversationId ? (state?.mode ?? "act") : draftMode;
  return { state, mode };
}
