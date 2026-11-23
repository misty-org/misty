import { useEffect } from "react";
import { resolveSetting, useDevicePreferences } from "@/features/settings";
import { useCollaborationStore } from "./store";
import type { ConversationCollaboration, ConversationMode } from "./plan_types";

export function useConversationCollaboration(accountId: string, conversationId?: string) {
  useEffect(() => {
    useCollaborationStore.getState().setAccount(accountId);
  }, [accountId]);
  const profile = useDevicePreferences((s) => s.state);
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
