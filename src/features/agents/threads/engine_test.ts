import { notify } from "@misty/ui";
import { listEngines, mistyEngine } from "../engines/engines_api";
import { newLocalConversation } from "../conversations/state/local_conversation";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { agentAccountId } from "../personal/agent_account";
import { newAgentOn } from "../personal/personal_agents_api";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { openAgentThread } from "../tutor/cursor/tutor_handoff";

export const ENGINE_TEST_PROMPT =
  "make a beautiful chess website and one medium difficulty bot with a free cloud based " +
  "stockfish or similar";

const testName = (engineName: string) => `${engineName} test`;

async function startThread(agentId: string): Promise<string> {
  const thread = newLocalConversation("Engine test", undefined, agentId);
  useMistyStore.setState((state) => ({
    conversations: [thread, ...state.conversations.filter((chat) => chat.id !== thread.id)],
  }));
  const before = useMistyStore.getState();
  const restore = { agent: before.selectedAgentId, active: before.activeConversationId };
  useMistyStore.setState({ selectedAgentId: agentId });
  try {
    await useMistyStore.getState().submitAnswer(ENGINE_TEST_PROMPT, [], undefined, [], {
      conversationId: thread.id,
      context: [],
    });
  } finally {
    useMistyStore.setState({
      selectedAgentId: restore.agent,
      activeConversationId: restore.active,
    });
  }
  return thread.id;
}

export async function tryEveryEngine(): Promise<void> {
  const account = agentAccountId();
  const engines = (await listEngines()).filter(
    (engine) => engine.installed && engine.id !== mistyEngine,
  );
  if (!engines.length) {
    notify({ message: "No engines are installed on this computer", tone: "error" });
    return;
  }
  const store = usePersonalAgentsStore.getState();
  await store.load(account);
  let first: { agentId: string; conversationId: string } | undefined;
  for (const engine of engines) {
    const existing = usePersonalAgentsStore
      .getState()
      .agents.find((agent) => agent.engine === engine.id && agent.name === testName(engine.name));
    const agent = existing ?? (await newAgentOn(account, engine, testName(engine.name)));
    if (!existing) await usePersonalAgentsStore.getState().load(account);
    try {
      const conversationId = await startThread(agent.id);
      first ??= { agentId: agent.id, conversationId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notify({ message: `${engine.name} couldn't start: ${reason}`, tone: "error" });
    }
  }
  if (first) openAgentThread(first.agentId, first.conversationId);
}
