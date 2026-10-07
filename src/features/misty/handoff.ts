import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "./useMistyStore";
import { readMistyDraftAttachments, useMistyDraftAttachments } from "./draftAttachments";
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
let handoffRevision = 0;
export async function acceptMistyHandoff(input: MistyHandoff) {
  const initial = useMistyStore.getState();
  const accountId = initial.accountId;
  const accountGeneration = useMistyDraftAttachments.getState().generation;
  if (input.accountId && accountId !== input.accountId)
    throw new Error("The Misty account changed.");
  const revision = ++handoffRevision;
  const assertCurrent = () => {
    if (
      useMistyStore.getState().accountId !== accountId ||
      useMistyDraftAttachments.getState().generation !== accountGeneration
    )
      throw new Error("The Misty account changed.");
    if (revision !== handoffRevision) throw new Error("A newer Misty request is open.");
  };
  const changesRequest = Object.keys(input).some(
    (key) => !["accountId", "agentId", "conversationId"].includes(key),
  );
  // Opening the same conversation is presentation only, including while a run is active.
  if (initial.working) {
    if (
      changesRequest ||
      (input.agentId && input.agentId !== initial.selectedAgentId) ||
      (input.conversationId && input.conversationId !== initial.activeConversationId)
    )
      throw new Error("Wait for Misty's current response before changing its context.");
    initial.openPanel();
    return;
  }
  if (input.agentId) {
    const agents = usePersonalAgentsStore.getState();
    if (agents.accountId !== accountId || !agents.agents.length) await agents.load(accountId);
    assertCurrent();
    if (!usePersonalAgentsStore.getState().agents.some((a) => a.id === input.agentId && a.enabled))
      throw new Error("This agent is unavailable.");
  }
  if (input.conversationId && !initial.conversations.some((c) => c.id === input.conversationId)) {
    await initial.loadConversations();
    assertCurrent();
  }
  const state = useMistyStore.getState();
  // Do not retarget a turn that started while the handoff was loading.
  if (state.working) throw new Error("Misty started working. Open its current conversation again.");
  const agentId = input.agentId ?? state.selectedAgentId;
  const defaultId = usePersonalAgentsStore.getState().agents.find((a) => a.system_managed)?.id;
  const belongsToAgent = (c: (typeof state.conversations)[number]) =>
    !agentId || c.agentId === agentId || (!c.agentId && agentId === defaultId);
  let conversationId = state.activeConversationId;
  if (input.conversationId) {
    const conversation = state.conversations.find((c) => c.id === input.conversationId);
    if (!conversation || (input.agentId && !belongsToAgent(conversation)))
      throw new Error("This conversation is unavailable for the selected agent.");
    conversationId = conversation.id;
  } else if (input.agentId && input.agentId !== state.selectedAgentId) {
    conversationId =
      [...state.conversations]
        .filter(belongsToAgent)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? "";
  }
  const switching =
    conversationId !== state.activeConversationId ||
    (input.agentId && input.agentId !== state.selectedAgentId);
  if (
    switching &&
    (state.query.trim() || readMistyDraftAttachments(accountId, state.activeConversationId).length)
  )
    throw new Error("Finish or clear the current draft before switching conversations.");
  if (input.prompt !== undefined && state.query.trim() && input.prompt !== state.query)
    throw new Error("Finish or clear the current draft before opening a different prompt.");
  if (switching) {
    if (conversationId) state.selectConversation(conversationId);
    else
      useMistyStore.setState({
        activeConversationId: "",
        query: "",
        context: [],
        handoff: undefined,
      });
  }
  if (input.agentId) {
    usePersonalAgentsStore.getState().select("", input.agentId);
    useMistyStore.setState({ selectedAgentId: input.agentId });
  }
  // A Space is attached context, never a reason to fork a conversation.
  if (changesRequest) {
    const current = useMistyStore.getState();
    useMistyStore.setState({
      mode: "ask",
      selectedSpaceId:
        input.spaceId ??
        input.context?.find((ref) => ref.spaceId)?.spaceId ??
        current.selectedSpaceId,
      query: input.prompt ?? current.query,
      context: input.context ?? current.context,
      handoff: input,
    });
  } else useMistyStore.setState({ mode: "ask" });
  useMistyStore.getState().openPanel();
}
export async function openMisty(input: MistyHandoff = {}) {
  await acceptMistyHandoff(input);
}
