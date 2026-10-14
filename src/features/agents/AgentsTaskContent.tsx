import { Button } from "@/shared/ui";
import { AgentWorkspaceConversation } from "./components/AgentWorkspaceConversation";
import { AgentConversationHeading } from "./page/AgentConversationHeading";
import { AgentDeviceTargets } from "./page/AgentDeviceTargets";
import { AgentLanding } from "./page/AgentLanding";
import { AgentNewChat } from "./page/AgentNewChat";
import type { AgentsPageActions, AgentsPageView } from "./agentsPageActions";
import type { AgentsPageState } from "./useAgentsPageState";

type AgentsTaskContentProps = {
  state: AgentsPageState;
  actions: AgentsPageActions;
  view: AgentsPageView;
};

/* The task column: error notice, conversation heading, then either the new-chat picker or the conversation. */
export function AgentsTaskContent({ state, actions, view }: AgentsTaskContentProps) {
  const {
    user,
    error,
    load,
    agents,
    profile,
    conversation,
    newChat,
    setNewChat,
    recipientSearch,
    setRecipientSearch,
    recipientInputRef,
    voiceRef,
    setVoiceState,
    chatRevision,
    activeConversationId,
    conversationSpaceId,
    draftSeed,
    guard,
  } = state;
  const { showWorkspace, switcher, disabled, taskWorking } = view;
  const { beginNewChat, create, select, openTemplates } = actions;
  return (
    <>
      <div className="agents-main">
        <div className="agents-body">
          <div className="agents-chat" data-scroll-root>
            {error && (
              <div role="alert" className="agents-notice">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load(user?.id ?? "")}>
                  Retry
                </Button>
              </div>
            )}
            <AgentConversationHeading
              workspace={showWorkspace}
              newChat={newChat}
              conversation={conversation}
              recipientSearch={recipientSearch}
              recipientInputRef={recipientInputRef}
              switcher={switcher}
              disabled={disabled}
              onRecipientSearch={setRecipientSearch}
              onCloseNewChat={() => setNewChat(false)}
              onNewChat={beginNewChat}
              working={taskWorking}
            />
            {newChat ? (
              <AgentNewChat
                agents={agents}
                search={recipientSearch}
                onCreate={create}
                onSelect={(id) => select(id, true)}
              />
            ) : (
              <AgentWorkspaceConversation
                key={`${user?.id}:${profile?.id}:${conversationSpaceId}:${chatRevision}`}
                agent={profile}
                spaceId={conversationSpaceId}
                accountId={user?.id ?? ""}
                showControlBar
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
                belowComposer={
                  showWorkspace && profile ? (
                    <>
                      <AgentDeviceTargets />
                      <AgentLanding
                        accountId={user?.id ?? ""}
                        agentId={profile.id}
                        onConversation={(id) => select(profile.id, false, id)}
                        onUseTemplate={(prompt) => select(profile.id, true, undefined, prompt)}
                        onTemplates={openTemplates}
                      />
                    </>
                  ) : undefined
                }
                onCreate={create}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
