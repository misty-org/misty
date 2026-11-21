import { Plus } from "lucide-react";
import { useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@misty/ui";
import type { GlobalAiConversation } from "../../conversations/state/conversationTypes";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { mistyEngine } from "../../engines/enginesApi";
import { AgentAvatar } from "../../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { useChatFolders, useProjectChats } from "../../shared-folders/chatFolder";
import { chatAgentOf, openCodeChat } from "./CodeChatColumn";

/**
 * The agent a new session in `project` starts with: the one from the latest chat there, else the
 * first agent that runs on an outside engine, else any.
 */
function lastAgentIn(
  project: string,
  conversations: readonly GlobalAiConversation[],
  projectChats: Record<string, string> | null,
  agents: readonly AgentProfile[],
): AgentProfile | undefined {
  let latest: GlobalAiConversation | undefined;
  for (const chat of conversations)
    if (projectChats?.[chat.id] === project && (!latest || chat.updatedAt > latest.updatedAt))
      latest = chat;
  return (
    (latest && chatAgentOf(agents, latest.agentId)) ??
    agents.find((agent) => agent.engine && agent.engine !== mistyEngine) ??
    agents[0]
  );
}

/**
 * New session in the page's project, with the agent from the last session there; the picker
 * beside it switches the agent for the next one.
 */
export function NewSessionControl(props: { project: string }) {
  const conversations = useMistyStore((state) => state.conversations);
  const projectChats = useProjectChats();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const [picked, setPicked] = useState<{ project: string; agentId: string } | null>(null);
  const last = lastAgentIn(props.project, conversations, projectChats, agents);
  const agent =
    (picked?.project === props.project &&
      agents.find((candidate) => candidate.id === picked.agentId)) ||
    last;
  const [busy, setBusy] = useState(false);
  const start = () => {
    if (!agent || !props.project || busy) return;
    setBusy(true);
    void useMistyStore
      .getState()
      .newConversation("", agent.id)
      .then(async (id) => {
        await useChatFolders.getState().use(id, props.project);
        openCodeChat(id);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const disabled = !agent || !props.project || busy;
  return (
    <>
      <IconButton
        label="New session"
        hint={agent ? `New session with ${agent.name}` : "New session"}
        disabled={disabled}
        onClick={start}
      >
        <Plus />
      </IconButton>
      <DropdownMenu>
        <MenuTrigger
          iconOnly
          chevron
          label="Agent for new sessions"
          icon={<AgentAvatar agent={agent} compact />}
          disabled={!agents.length}
        />
        <DropdownMenuContent align="end" width="lg">
          <MenuRadioGroup
            value={agent?.id ?? ""}
            onValueChange={(agentId) => setPicked({ project: props.project, agentId })}
          >
            {agents.map((candidate) => (
              <MenuRadioItem
                key={candidate.id}
                value={candidate.id}
                icon={<AgentAvatar agent={candidate} compact />}
                label={candidate.name}
              />
            ))}
          </MenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
