import { create } from "zustand";
import { usePersonalAgentsStore } from "../../../personal/personalAgentsStore";
import { agentsInFolder } from "../../../shared-folders/folderAgents";

/** A chat from an engine's own history, wherever it ran. */
export interface PastChat {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title: string;
}

/** Who continues a past chat, and the folder it works in there. */
export interface PastChatAgent {
  agentId: string;
  folder: string;
}

interface PastChatAsk {
  asking?: {
    chat: PastChat;
    preferred?: string;
    answer(agent: PastChatAgent | null): void;
  };
}

/** The open question, if any, of which agent gets a past chat's folder (`PastChatFolderHost`). */
export const usePastChatAsk = create<PastChatAsk>(() => ({}));

/**
 * The agent that continues a past chat. An agent on the chat's engine that already works in its
 * folder does, `preferred` first. Otherwise the person is asked to give the folder to one, an
 * existing agent or a new one; null when they don't.
 */
export async function agentForPastChat(
  chat: PastChat,
  preferred?: string,
): Promise<PastChatAgent | null> {
  const onEngine = new Set(
    usePersonalAgentsStore
      .getState()
      .agents.filter((agent) => agent.engine === chat.engine)
      .map((agent) => agent.id),
  );
  const owners = (await agentsInFolder(chat.workspacePath)).filter((id) => onEngine.has(id));
  const owner = preferred && owners.includes(preferred) ? preferred : owners[0];
  if (owner) return { agentId: owner, folder: chat.workspacePath };
  return new Promise((resolve) => {
    usePastChatAsk.getState().asking?.answer(null);
    usePastChatAsk.setState({
      asking: {
        chat,
        preferred,
        answer: (agent) => {
          usePastChatAsk.setState({ asking: undefined });
          resolve(agent);
        },
      },
    });
  });
}

/** The route of an agent's chat. */
export const pastChatRoute = (agentId: string, conversationId: string) =>
  `/agents?${new URLSearchParams({ agent: agentId, conversation: conversationId })}`;
