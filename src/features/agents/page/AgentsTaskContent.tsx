import { ChatStart, ChatStartIdeas } from "./ChatStart";
import { needsDefaultEngine, openEngineSettings } from "../engines/engine_needed";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { AgentWorkspaceConversation } from "../conversations/view/AgentWorkspaceConversation";
import { AgentConversationHeading, ChatHeaderButtons, ChatTitle } from "./AgentConversationHeading";
import type { AgentsPageActions, AgentsPageView } from "./agents_page_actions";
import type { AgentsPageState } from "./use_agents_page_state";
import { AgentBrowserPip } from "../agent-browser/AgentBrowserPip";
import { setBrowserExpanded } from "../agent-browser/agent_browser_store";
import { chatKey } from "../conversations/state/draft_chat";
import { cn, Separator, Surface, windowToolbarClass } from "@misty/ui";

export const floatingHeaderClass = cn(
  "absolute inset-[0_var(--misty-scrollbar-size)_auto_0] z-[var(--stack-raised)]",
  "h-[var(--agents-chat-header)] min-h-0",
);

export const studioBarClass = "box-border flex flex-none items-center gap-2 px-3";

export const chatColumnClass = cn(
  "agents-chat relative flex min-h-0 min-w-90 flex-1 flex-col overflow-hidden",
  "[&>:not(.agent-conversation)]:shrink-0",
  "[--agents-chat-header:0px] [--agent-conversation-inset:var(--agents-chat-header)]",
  "has-[>.agent-conversation-heading]:[--agents-chat-header:--spacing(13.5)]",
  "has-[>.agent-studio-bar]:[--agents-chat-header:var(--ui-header)]",
  "[&>.agent-conversation-heading]:absolute",
  "[&>.agent-conversation-heading]:inset-[0_var(--misty-scrollbar-size)_auto_0]",
  "[&>.agent-conversation-heading]:z-[var(--stack-raised)]",
  "[&>.agent-conversation-heading]:h-[var(--agents-chat-header)]",
  "[&>.agent-conversation-heading]:min-h-0",
  "[&_.agent-conversation-scroll]:pt-[var(--agent-conversation-inset)]",
  "[&_.agent-conversation-scroll]:scroll-pt-[var(--agent-conversation-inset)]",
);

type AgentsTaskContentProps = {
  state: AgentsPageState;
  actions: AgentsPageActions;
  view: AgentsPageView;
};

export function AgentsTaskContent({ state, actions, view }: AgentsTaskContentProps) {
  const {
    user,
    error,
    load,
    profile,
    conversation,
    voiceRef,
    setVoiceState,
    chatRevision,
    activeConversationId,
    conversationSpaceId,
    draftSeed,
    guard,
  } = state;
  const { showWorkspace, disabled } = view;
  const { create } = actions;
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col in-data-[settings-open=true]:mr-105">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden [container:agents-body/size]">
          <div className={chatColumnClass} data-file-drop-area="">
            <ErrorNotice
              message={error}
              action={
                needsDefaultEngine(error)
                  ? { label: "Open engine settings", onSelect: openEngineSettings }
                  : { label: "Retry", onSelect: () => void load(user.id) }
              }
            />
            {!showWorkspace ? (
              <AgentConversationHeading
                conversation={conversation}
                agent={profile}
                disabled={disabled}
              />
            ) : state.workspacePage === "task" ? (
              <Surface
                as="header"
                tone="sidebar"
                className={cn(
                  "agent-studio-bar",
                  floatingHeaderClass,
                  studioBarClass,
                  windowToolbarClass,
                )}
                data-window-toolbar
              >
                <ChatTitle conversation={conversation} agent={profile} />
                <ChatHeaderButtons />
                <Separator className="absolute inset-x-0 bottom-0" />
              </Surface>
            ) : null}
            <AgentBrowserPip
              conversationId={chatKey(activeConversationId)}
              onDock={() => setBrowserExpanded(chatKey(activeConversationId), true)}
            />
            <AgentWorkspaceConversation
              key={`${user?.id}:${profile?.id}:${conversationSpaceId}:${chatRevision}`}
              agent={profile}
              conversationId={activeConversationId}
              spaceId={conversationSpaceId}
              accountId={user.id}
              initialDraft={
                !activeConversationId && draftSeed.agentId === profile?.id ? draftSeed.text : ""
              }
              voiceControlRef={voiceRef}
              onVoiceStateChange={setVoiceState}
              onDraftStateChange={guard.setConversationStatus}
              emptyContent={profile ? <ChatStart agent={profile} /> : undefined}
              emptyFooter={profile ? <ChatStartIdeas agent={profile} /> : undefined}
              onCreate={create}
              onNewChat={() => profile && actions.select(profile.id, true)}
            />
          </div>
        </div>
      </div>
    </>
  );
}
