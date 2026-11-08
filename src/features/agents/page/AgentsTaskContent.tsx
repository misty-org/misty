import { ModelKeyNeededButton, needsModelKey } from "../models/ModelKeyNeeded";
import { Button, ErrorNotification } from "@/shared/ui";
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
  const { showWorkspace, switcher, disabled, taskWorking } = view;
  const { create } = actions;
  return (
    <>
      <div className="agents-main">
        <div className="agents-body">
          <div className="agents-chat">
            <ErrorNotification message={error}>
              {needsModelKey(error) ? (
                <ModelKeyNeededButton />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void load(user?.id ?? "")}
                >
                  Retry
                </Button>
              )}
            </ErrorNotification>
            <AgentConversationHeading
              workspace={showWorkspace}
              conversation={conversation}
              switcher={switcher}
              disabled={disabled}
              working={taskWorking}
            />
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
              spaceId={conversationSpaceId}
              accountId={user?.id ?? ""}
              initialDraft={
                !activeConversationId && draftSeed.agentId === profile?.id ? draftSeed.text : ""
              }
              voiceControlRef={voiceRef}
              onVoiceStateChange={setVoiceState}
              onDraftStateChange={guard.setConversationStatus}
              emptyContent={
                profile ? (
                  <div className="agent-studio-welcome">
                    <h1>What can I do for you?</h1>
                  </div>
                ) : undefined
              }
              onCreate={create}
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
