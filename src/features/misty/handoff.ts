import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "./useMistyStore";
import type {
  AiCaptureAttachment,
  AiArtifactKind,
  AiInvocationDeviceContext,
  AiSelectionSnapshot,
  AiSurfaceId,
} from "@/features/ai-surface/types";
import type { GlobalAiContextRef } from "@/features/global-search/types";

export interface MistyHandoff {
  agentId?: string;
  capture?: AiCaptureAttachment;
  requestId?: string;
  notice?: string;
  prompt?: string;
  spaceId?: string;
  accountId?: string;
  context?: GlobalAiContextRef[];
  selection?: AiSelectionSnapshot;
  deviceContexts?: AiInvocationDeviceContext[];
  paneId?: string;
  surfaceId?: AiSurfaceId;
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
}
export async function acceptMistyHandoff(input: MistyHandoff) {
  const state = useMistyStore.getState();
  if (input.accountId && state.accountId !== input.accountId)
    throw new Error("The Misty account changed.");
  if (state.working)
    throw new Error("Wait for Misty's current response before changing its context.");
  const spaceId = input.spaceId || input.context?.find((ref) => ref.spaceId)?.spaceId || "";
  if (input.agentId) {
    await usePersonalAgentsStore.getState().load(state.accountId);
    if (!usePersonalAgentsStore.getState().agents.some((a) => a.id === input.agentId && a.enabled))
      throw new Error("This agent is unavailable.");
    usePersonalAgentsStore.getState().select(spaceId, input.agentId);
    useMistyStore.setState({ selectedAgentId: input.agentId });
  }
  const current = state.conversations.find((c) => c.id === state.activeConversationId);
  if (input.conversationId) {
    await state.loadConversations();
    const conversation = useMistyStore
      .getState()
      .conversations.find((c) => c.id === input.conversationId);
    if (!conversation || conversation.spaceId !== spaceId)
      throw new Error("This conversation is unavailable in the selected Space.");
    state.selectConversation(input.conversationId);
  } else if (
    current &&
    (current.spaceId !== spaceId || (input.agentId && current.agentId !== input.agentId))
  )
    await state.newConversation(spaceId);
  if (useMistyStore.getState().accountId !== state.accountId)
    throw new Error("The Misty account changed.");
  useMistyStore.setState({
    mode: "ask",
    selectedSpaceId: spaceId,
    query: input.prompt ?? state.query,
    context: input.context ?? state.context,
    handoff: input,
  });
  useMistyStore.getState().openPanel();
}
export async function openMisty(input: MistyHandoff = {}) {
  await acceptMistyHandoff(input);
}
