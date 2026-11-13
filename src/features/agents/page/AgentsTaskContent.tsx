import { ChatStart, ChatStartIdeas } from "./ChatStart";
import { needsModelKey } from "../models/ModelKeyNeeded";
import { openModelSettings } from "../models/modelKeys";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { AgentWorkspaceConversation } from "../conversations/view/AgentWorkspaceConversation";
import { AgentConversationHeading, ChatTitle } from "./AgentConversationHeading";
import type { AgentsPageActions, AgentsPageView } from "./agentsPageActions";
import type { AgentsPageState } from "./useAgentsPageState";
import { AgentBrowserPip } from "../agent-browser/AgentBrowserPip";
import { setBrowserExpanded } from "../agent-browser/agentBrowserStore";
import { chatKey } from "../conversations/state/draftChat";
import { cn, windowToolbarClass } from "@/shared/ui";

/**
 * The chat's header (the heading, or the studio bar in the workspace) floats over the top of the
 * conversation and stops short of its scrollbar, so the scrollbar runs the column's full height.
 * The conversation's content starts below the header instead: `--agent-conversation-inset` is how
 * far, for the scroller and for anything floating over the conversation.
 */
const floatingHeaderClass = cn(
  "absolute inset-[0_var(--misty-scrollbar-size)_auto_0] z-[var(--stack-raised)]",
  "h-[var(--agents-chat-header)] min-h-0",
);

/** The studio bar: plain buttons in one row on the window's own surface. */
const studioBarClass = "box-border flex flex-none items-center gap-2 px-3";

/**
 * The chat column. Rows keep their content height so the column overflows and scrolls instead of
 * squeezing; the conversation fills what is left. The agent browser's picture-in-picture floats
 * over the column, clear of the header.
 */
const chatColumnClass = cn(
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

/* The task column: error notice, conversation heading, then the conversation. */
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
        {/* Only the chat column (header and conversation) scrolls. */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden [container:agents-body/size]">
          {/* Files dropped anywhere on the chat column go to its message box. */}
          <div className={chatColumnClass} data-file-drop-area="">
            <ErrorNotice
              message={error}
              action={
                needsModelKey(error)
                  ? { label: "Open Models settings", onSelect: openModelSettings }
                  : { label: "Retry", onSelect: () => void load(user.id) }
              }
            />
            {/* The header floats over the conversation's top, short of its scrollbar, so the
                scrollbar runs the column's full height. In the workspace it is the studio bar,
                naming the chat; the tab above names its agent. */}
            {!showWorkspace ? (
              <AgentConversationHeading
                conversation={conversation}
                agent={profile}
                disabled={disabled}
              />
            ) : state.workspacePage === "task" ? (
              // The page's one top band, as tall as the sidebar's head, with plain buttons on it.
              <header
                className={cn(
                  "agent-studio-bar",
                  floatingHeaderClass,
                  studioBarClass,
                  windowToolbarClass,
                )}
                data-window-toolbar
              >
                <ChatTitle conversation={conversation} />
              </header>
            ) : null}
            {/* The agent browser as a picture-in-picture floating over the chat; opening it puts
                the browser back in its panel beside the chat. */}
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
