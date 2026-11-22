import { newLocalConversation } from "./state/localConversation";
import { useMistyStore } from "./state/useMistyStore";
import { useCollaborationStore } from "../plans/store";

type Started = { conversationId: string; started: boolean; error?: string };

export async function startRun(input: {
  agentId: string;
  title: string;
  prompt: string;
  mode: "act" | "teach";
  background: boolean;
  stay?: boolean;
  conversationId?: string;
}): Promise<Started> {
  const store = useMistyStore.getState();
  let conversationId = input.conversationId;
  if (!conversationId) {
    const conversation = newLocalConversation(input.title, undefined, input.agentId);
    useMistyStore.setState((state) => ({
      conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)],
    }));
    conversationId = conversation.id;
    if (input.mode === "teach")
      await useCollaborationStore
        .getState()
        .setMode(conversationId, "teach")
        .catch(() => undefined);
  }
  if (store.working) return { conversationId, started: false };
  const before = { agent: store.selectedAgentId, active: store.activeConversationId };
  useMistyStore.setState({ selectedAgentId: input.agentId });
  try {
    await useMistyStore.getState().submitAnswer(
      input.prompt,
      [],
      undefined,
      [],
      { conversationId, context: [] },
      {
        executionMode: "user",
        idempotencyKey: `tutor:${conversationId}:${Date.now()}`,
        collaborationMode: input.mode,
        ...(input.background ? { permissionMode: "auto" as const } : {}),
      },
    );
  } catch (error) {
    return {
      conversationId,
      started: false,
      error: error instanceof Error ? error.message : "Misty could not start this run.",
    };
  } finally {
    if (input.background || input.stay)
      useMistyStore.setState({
        selectedAgentId: before.agent,
        activeConversationId: before.active,
      });
  }
  const after = useMistyStore.getState();
  const started = after.invocationConversationId === conversationId && Boolean(after.invocationId);
  return { conversationId, started, error: started ? undefined : (after.error ?? undefined) };
}
