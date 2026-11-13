import "./agentsWorkspace.css";
import { useEffect, useState } from "react";
import { AgentSettingsModal } from "../personal/AgentSettingsModal";
import { AgentSetup } from "../personal/AgentSetup";
import { AgentEditor } from "../personal/AgentEditor";
import { AgentDiscardDialog } from "./AgentDiscardDialog";
import { ChatTitle } from "./AgentConversationHeading";
import { AgentWorkspaceFrame } from "../methods/AgentWorkspaceFrame";
import { AgentsTaskContent } from "./AgentsTaskContent";
import { createAgentsPageActions, deriveAgentsPageView } from "./agentsPageActions";
import { useAgentsPageState } from "./useAgentsPageState";
import { useCollaborationStore } from "../plans/store";

/* Agents opens straight into a conversation with the selected agent, which stays mounted across catalogs. */
export default function NativeAgentsPage() {
  return <AgentsWorkspacePage />;
}

function AgentsWorkspacePage() {
  const state = useAgentsPageState();
  // Agents group by their home Space here; the quick panel just lists them.
  const actions = createAgentsPageActions(state);
  const view = deriveAgentsPageView(state);
  const {
    user,
    spaceId,
    loading,
    profile,
    access,
    guard,
    workspacePage,
    settingsModalOpen,
    settingsModalTab,
    settingsModalMode,
    setSettingsModalOpen,
    setWorkspacePage,
    setParams,
    agentConversations,
    activity,
    activeConversationId,
    workspaceRef,
    agents,
    load,
  } = state;
  const { change, setEditorStatus } = guard;
  const { select, closeSettings, saveProfile, removeProfile, openApps } = actions;
  // The Studio opens any agent's settings without moving the page to that agent's chat.
  const [editingId, setEditingId] = useState<string>();
  useEffect(() => {
    if (!settingsModalOpen) setEditingId(undefined);
  }, [settingsModalOpen]);
  const editing = agents.find((agent) => agent.id === editingId) ?? profile;
  const elsewhere = Boolean(editing && editing.id !== profile?.id);
  const settleElsewhere = async () => {
    await load(user?.id ?? "");
    guard.cancel();
    setSettingsModalOpen(false);
  };
  const profileSection = () =>
    editing && (
      <AgentEditor
        key={`${user?.id}:${editing.id}:${spaceId}`}
        profile={editing}
        onStatusChange={setEditorStatus}
        onSaved={elsewhere ? settleElsewhere : saveProfile}
        onRemoved={elsewhere ? settleElsewhere : removeProfile}
      />
    );
  const { showWorkspace } = view;
  const taskContent = <AgentsTaskContent state={state} actions={actions} view={view} />;
  return (
    <main ref={workspaceRef} className="agents-workspace" data-settings-open={settingsModalOpen}>
      {showWorkspace && profile ? (
        <AgentWorkspaceFrame
          key={`${user?.id}:${profile.id}`}
          agent={profile}
          page={workspacePage}
          conversations={agentConversations}
          activity={activity.entries}
          conversationId={activeConversationId}
          disabled={view.disabled}
          title={<ChatTitle conversation={state.conversation} />}
          onPageChange={(page) =>
            page === "task"
              ? change(() => {
                  setWorkspacePage("task");
                  const next = new URLSearchParams(state.params);
                  next.delete("view");
                  setParams(next, { replace: true });
                }, false)
              : actions.openPage(page)
          }
          onLearn={(prompt) => {
            void useCollaborationStore.getState().setMode(undefined, "teach");
            select(profile.id, true, undefined, prompt);
          }}
          onAgentSettings={(agentId) => {
            setEditingId(agentId);
            actions.openSettingsModal("settings");
          }}
          onNewTask={() => select(profile.id, true)}
          onConversation={(id) => select(profile.id, false, id)}
        >
          {taskContent}
        </AgentWorkspaceFrame>
      ) : loading && !profile ? null : (
        taskContent
      )}
      <AgentSettingsModal
        open={settingsModalOpen}
        onOpenChange={(open) => (open ? setSettingsModalOpen(true) : closeSettings())}
        activeTab={settingsModalTab}
        mode={settingsModalMode}
      >
        {settingsModalMode === "edit" && profileSection()}
        {settingsModalMode === "create" && (
          <AgentSetup
            key={`${user?.id}:create`}
            access={access}
            onConnections={openApps}
            onStatusChange={setEditorStatus}
            onSaved={saveProfile}
          />
        )}
      </AgentSettingsModal>
      <AgentDiscardDialog open={guard.pending} onCancel={guard.cancel} onDiscard={guard.discard} />
    </main>
  );
}
