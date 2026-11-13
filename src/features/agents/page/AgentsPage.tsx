import { useEffect, useState } from "react";
import { Surface } from "@/shared/ui";
import { AgentSettingsModal } from "../personal/AgentSettingsModal";
import { AgentSetup } from "../personal/AgentSetup";
import { AgentEditor } from "../personal/AgentEditor";
import { AgentDiscardDialog } from "./AgentDiscardDialog";
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
    await load(user.id);
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
    <Surface
      as="main"
      tone="workspace"
      ref={workspaceRef}
      className={
        "@container/agents relative flex h-full min-h-0 min-w-0 overflow-hidden " +
        "text-control leading-normal"
      }
      data-settings-open={settingsModalOpen}
    >
      {showWorkspace && profile ? (
        // Keyed by account only: switching to another agent's chat keeps the frame (rail, side
        // panels, pages) mounted instead of building it all again.
        <AgentWorkspaceFrame
          key={user?.id}
          agent={profile}
          page={workspacePage}
          conversations={agentConversations}
          activity={activity.entries}
          conversationId={activeConversationId}
          disabled={view.disabled}
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
    </Surface>
  );
}
