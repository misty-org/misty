import { MessagesSquare, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { useSpeechSupport } from "@/features/voice";
import { ChannelHeader, cn, FramedBar, profileIcons, windowToolbarClass } from "@misty/ui";
import { chatCallItems, chatMoreItem } from "@/shared/hooks/ChatBarItems";
import { agentCallsHost } from "../calls/agent_calls_host";
import { startAgentCall } from "../calls/start_agent_call";
import { useEnginesList } from "../engines/engines_api";
import { mistyEngine } from "../engines/misty_engine";
import { AgentConversationActions } from "../conversations/view/AgentConversationActions";
import { useConversationActions } from "../conversations/view/UseConversationActions";
import { AgentAvatar } from "../personal/AgentAvatar";
import { AgentIdentity } from "../personal/AgentIdentity";
import { useContextPanel } from "../context-panel/context_panel_store";
import { useRailShown } from "../context-panel/rail_layout_store";

const notBusy = () => false;
const noTranscript = () => ({ inCall: false, shown: false, toggle: () => undefined });

function useAgentSees(agent?: AgentProfile): boolean {
  const engines = useEnginesList().data;
  if (!agent) return false;
  if (!agent.engine || agent.engine === mistyEngine) return true;
  return Boolean(engines?.find((engine) => engine.id === agent.engine)?.supportsImages);
}

export function AgentStudioBar({
  agent,
  conversation,
  disabled = false,
  callable = false,
}: {
  agent?: AgentProfile;
  conversation?: { id: string; title?: string };
  disabled?: boolean;
  callable?: boolean;
}) {
  const profileOpen = useContextPanel((state) => state.tab === "profile");
  const railShown = useRailShown((state) => state.value);
  const useBusy = agentCallsHost.maybe()?.useBusy ?? notBusy;
  const busy = useBusy();
  const useTranscript = agentCallsHost.maybe()?.useTranscript ?? noTranscript;
  const transcript = useTranscript(conversation?.id);
  const sees = useAgentSees(agent);
  const speech = useSpeechSupport();
  const talks = Boolean(speech?.speaking && speech.recognition);
  const conversationActions = useConversationActions({
    conversation: conversation ?? { id: "" },
    disabled,
  });
  const calls =
    callable && talks && agent && agentCallsHost.maybe()
      ? {
          disabled: busy,
          videoDisabled: !sees,
          start: (video: boolean) =>
            startAgentCall({ agent, conversationId: conversation?.id, video, sees }),
        }
      : undefined;
  return (
    <>
      <ChannelHeader
        leading={<AgentAvatar agent={agent} face />}
        name={agent?.name ?? "Agent"}
        actions={[
          ...chatCallItems(calls),
          ...(transcript.inCall
            ? [
                {
                  id: "threads",
                  icon: MessagesSquare,
                  label: "Thread",
                  priority: 9,
                  pressed: transcript.shown,
                  onSelect: transcript.toggle,
                },
              ]
            : []),
          {
            id: "tools",
            icon: Wrench,
            label: "Tools",
            priority: 3,
            pressed: railShown,
            onSelect: () => useRailShown.getState().set(!railShown),
          },
          {
            id: "profile",
            icon: profileIcons.agent,
            label: "Profile",
            priority: 5,
            pressed: profileOpen,
            onSelect: () => useContextPanel.getState().toggle("profile"),
          },
          ...chatMoreItem(conversation ? conversationActions.rows : undefined),
        ]}
      />
      {conversation ? conversationActions.dialogs : null}
    </>
  );
}

const headingAvatarClass = "[&_.agent-avatar]:size-8! [&_.agent-avatar]:text-control!";

export function AgentConversationHeading({
  conversation,
  agent,
  disabled,
  actions,
  panelPicker,
}: {
  conversation?: { id: string; title?: string };
  agent?: AgentProfile;
  disabled: boolean;
  actions?: ReactNode;
  panelPicker?: ReactNode;
}) {
  return (
    <FramedBar
      className={cn("agent-conversation-heading", windowToolbarClass)}
      data-window-toolbar=""
      data-tauri-drag-region=""
      data-misty-window-titlebar-region="true"
      start={
        <>
          {panelPicker ? (
            <span className={cn("inline-flex flex-none", headingAvatarClass)}>
              <AgentAvatar agent={agent} />
            </span>
          ) : (
            <AgentIdentity
              agent={agent}
              className={cn(
                "inline-flex min-w-0 max-w-[60%] flex-[0_1_auto] items-center gap-1.5",
                headingAvatarClass,
              )}
            />
          )}
          {panelPicker}
        </>
      }
    >
      {conversation || actions ? (
        <div className="flex flex-none items-center justify-end [&>*]:shrink-0">
          {conversation && (
            <AgentConversationActions conversation={conversation} disabled={disabled} />
          )}
          {actions}
        </div>
      ) : null}
    </FramedBar>
  );
}
