import { ChatStart } from "./ChatStart";
import { needsModelKey } from "../models/ModelKeyNeeded";
import { openModelSettings } from "../models/modelKeys";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { AgentWorkspaceConversation } from "../conversations/view/AgentWorkspaceConversation";
import { AgentConversationHeading } from "./AgentConversationHeading";
import type { AgentsPageActions, AgentsPageView } from "./agentsPageActions";
import type { AgentsPageState } from "./useAgentsPageState";
import { AgentBrowser } from "../agent-browser/AgentBrowser";
import { AgentBrowserPip } from "../agent-browser/AgentBrowserPip";
import { setBrowserExpanded } from "../agent-browser/agentBrowserStore";

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
      <div className="agents-main">
        <div className="agents-body">
          <div className="agents-chat">
            <ErrorNotice
              message={error}
              action={
                needsModelKey(error)
                  ? { label: "Open Models settings", onSelect: openModelSettings }
                  : { label: "Retry", onSelect: () => void load(user?.id ?? "") }
              }
            />
            {/* In the workspace the studio bar above carries the chat's title. */}
            {showWorkspace ? null : (
              <AgentConversationHeading
                conversation={conversation}
                agent={profile}
                disabled={disabled}
              />
            )}
            {/* The agent browser shrunk to a picture; clicking it opens the split again. */}
            <AgentBrowserPip
              conversationId={activeConversationId ?? undefined}
              onExpand={() =>
                activeConversationId && setBrowserExpanded(activeConversationId, true)
              }
            />
            <AgentWorkspaceConversation
              key={`${user?.id}:${profile?.id}:${conversationSpaceId}:${chatRevision}`}
              agent={profile}
              conversationId={activeConversationId}
              spaceId={conversationSpaceId}
              accountId={user?.id ?? ""}
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
          {/* The agent's own browser beside the chat. */}
          <AgentBrowser
            key={activeConversationId ?? ""}
            conversationId={activeConversationId ?? undefined}
          />
        </div>
      </div>
    </>
  );
}
