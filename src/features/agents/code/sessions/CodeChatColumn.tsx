import { X } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, IconButton, Surface } from "@misty/ui";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { AgentWorkspaceConversation } from "../../conversations/view/AgentWorkspaceConversation";
import { openAgentsHub } from "../../hub/agentsHubStore";
import { ChatTitle } from "../../page/AgentConversationHeading";
import {
  chatColumnClass,
  floatingHeaderClass,
  studioBarClass,
} from "../../page/AgentsTaskContent";
import { useAgentAccountId } from "../../personal/agentAccount";
import { AgentAvatar } from "../../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { useChatFolders } from "../../shared-folders/chatFolder";
import { updateCodePageLayout } from "../codePageStore";

/** A chat's agent, as the sidebar finds it: its own, or Misty's for a chat with none. */
export function chatAgentOf(
  agents: readonly AgentProfile[],
  agentId: string | undefined,
): AgentProfile | undefined {
  return (
    agents.find((agent) => agent.id === agentId) ??
    (agentId ? undefined : agents.find((agent) => agent.system_managed))
  );
}

/**
 * Opens a chat in the Code page's column, remembered for this device. It becomes the open chat,
 * as picking it in the sidebar makes it, so its draft and run follow it.
 */
export function openCodeChat(conversationId: string) {
  updateCodePageLayout({ chat: conversationId });
  if (useMistyStore.getState().activeConversationId !== conversationId)
    useMistyStore.getState().selectConversation(conversationId);
}

/**
 * The chat open in the Code page, beside the editor: the task page's conversation, under a bar
 * that names it and closes the column. The page works in this chat's folder while it is open.
 */
export function CodeChatColumn({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose(): void;
}) {
  const accountId = useAgentAccountId();
  const conversation = useMistyStore((state) =>
    state.conversations.find((chat) => chat.id === conversationId),
  );
  const agent = usePersonalAgentsStore((state) =>
    chatAgentOf(state.agents, conversation?.agentId),
  );
  // `/new`: another chat with this agent, in the same project, opened here.
  const newChat = () => {
    if (!agent) return;
    const folder = useChatFolders.getState().byConversation[conversationId];
    void useMistyStore
      .getState()
      .newConversation("", agent.id)
      .then((id) => {
        if (folder?.kind === "project")
          void useChatFolders
            .getState()
            .use(id, folder.path)
            .catch(() => undefined);
        updateCodePageLayout({ chat: id });
      });
  };
  return (
    // Files dropped on the column go to its message box, as on the task page.
    <div className={chatColumnClass} data-file-drop-area="">
      <Surface
        as="header"
        tone="page"
        className={cn("agent-studio-bar", floatingHeaderClass, studioBarClass)}
      >
        {/* In Code the agent works quietly: its small mark, no persona. */}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex flex-none">
            <AgentAvatar agent={agent} compact />
          </span>
          <ChatTitle conversation={conversation} />
        </span>
        <IconButton label="Close chat" onClick={onClose}>
          <X />
        </IconButton>
      </Surface>
      <AgentWorkspaceConversation
        key={`${accountId}:${conversationId}`}
        agent={agent}
        conversationId={conversationId}
        spaceId=""
        accountId={accountId}
        onCreate={() => openAgentsHub("agents")}
        onNewChat={newChat}
      />
    </div>
  );
}
