import "./agentsWorkspace.css";
import { AgentSettingsModal } from "../personal/AgentSettingsModal";
import { AgentSetup } from "../personal/AgentSetup";
import { AgentSwitcher } from "../personal/AgentSwitcher";
import { AgentEditor } from "../personal/AgentEditor";
import { AgentDiscardDialog } from "./AgentDiscardDialog";
import { AgentWorkspaceFrame } from "../methods/AgentWorkspaceFrame";
import { AgentsTaskContent } from "./AgentsTaskContent";
import { createAgentsPageActions, deriveAgentsPageView } from "./agentsPageActions";
import { useAgentsPageState } from "./useAgentsPageState";
import { useCollaborationStore } from "../plans/store";

/*
 * THESIS: Agents opens straight into a conversation with the selected agent.
 * OWN-WORLD: Misty monochrome shared controls, 6px buttons, 8px islands, existing cloud avatars.
 * STORY: Start a task or resume recent work.
 * FIRST VIEWPORT: The New task composer and what the agent can reach.
 * FORM: Polar's page columns and catalog density inside Misty; no Spaces navigation.
 * SIGNATURE: The conversation stays mounted across catalogs.
 */
export default function NativeAgentsPage() {
  return <AgentsWorkspacePage />;
}

function AgentsWorkspacePage() {
  const state = useAgentsPageState();
  // Agents group by their home Space here; the quick panel just lists them.
  const actions = createAgentsPageActions(state);
  const view = deriveAgentsPageView(state, actions);
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
    identityRef,
  } = state;
  const { change, setEditorStatus } = guard;
  const { select, closeSettings, saveProfile, removeProfile, openApps } = actions;
  const profileSection = () =>
    profile && (
      <AgentEditor
        key={`${user?.id}:${profile.id}:${spaceId}`}
        profile={profile}
        onStatusChange={setEditorStatus}
        onSaved={saveProfile}
        onRemoved={removeProfile}
      />
    );
  const { showWorkspace, switcher } = view;
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
          identity={<AgentSwitcher {...switcher} className="agent-studio-identity" />}
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
      <AgentDiscardDialog
        open={guard.pending}
        onCancel={guard.cancel}
        onDiscard={guard.discard}
        restoreFocus={() => {
          if (workspacePage !== "task")
            workspaceRef.current
              ?.querySelector<HTMLButtonElement>('.agent-studio-sidebar [aria-current="page"]')
              ?.focus();
          else identityRef.current?.focus();
        }}
      />
    </main>
  );
}
