import { ChatStart } from "./ChatStart";
import { needsDefaultEngine, openEngineSettings } from "../engines/engine_needed";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { AgentWorkspaceConversation } from "../conversations/view/AgentWorkspaceConversation";
import { AgentConversationHeading, AgentStudioBar } from "./AgentConversationHeading";
import type { AgentsPageActions, AgentsPageView } from "./agents_page_actions";
import type { AgentsPageState } from "./use_agents_page_state";
import { AgentBrowserPip } from "../agent-browser/AgentBrowserPip";
import { setBrowserExpanded } from "../agent-browser/agent_browser_store";
import { chatKey } from "../conversations/state/draft_chat";

const chatColumnClass =
  "agents-chat relative flex min-h-0 min-w-90 flex-1 flex-col overflow-hidden " +
  "[&>:not(.agent-conversation)]:shrink-0";

export function AgentsTaskHeader({
  state,
  view,
}: {
  state: AgentsPageState;
  view: AgentsPageView;
}) {
  if (!view.showWorkspace)
    return (
      <AgentConversationHeading
        conversation={state.conversation}
        agent={state.profile}
        disabled={view.disabled}
      />
    );
  return <AgentStudioBar conversation={state.conversation} agent={state.profile} />;
}

type AgentsTaskContentProps = {
  state: AgentsPageState;
  actions: AgentsPageActions;
};

export function AgentsTaskContent({ state, actions }: AgentsTaskContentProps) {
  const {
    user,
    error,
    load,
    profile,
    voiceRef,
    setVoiceState,
    chatRevision,
    activeConversationId,
    conversationSpaceId,
    draftSeed,
    guard,
  } = state;
  const { create } = actions;
  return (
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
            onCreate={create}
            onNewChat={() => profile && actions.select(profile.id, true)}
          />
        </div>
      </div>
    </div>
  );
}
