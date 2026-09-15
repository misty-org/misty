import "./agentsWorkspace.css";
import { AgentSettingsModal } from "./components/AgentSettingsModal";
import { AgentSetup } from "./components/AgentSetup";
import { AgentSwitcher } from "./components/AgentSwitcher";
import { ProjectReviewSheet } from "./components/changes/ProjectReviewSheet";
import { AgentProfileSection } from "./page/AgentProfileSection";
import { AgentDiscardDialog } from "./page/AgentDiscardDialog";
import { AgentWorkspaceFrame } from "./workspace/AgentWorkspaceFrame";
import { AgentsTaskContent } from "./AgentsTaskContent";
import { createAgentsPageActions, deriveAgentsPageView } from "./agentsPageActions";
import { useAgentsPageState } from "./useAgentsPageState";

/*
 * THESIS: Agents opens straight into a conversation with the selected agent.
 * OWN-WORLD: Misty monochrome shared controls, 6px buttons, 8px islands, existing cloud avatars.
 * STORY: Start a task, resume recent work, or browse reusable guidance.
 * FIRST VIEWPORT: The New task composer, what the agent can reach, recent work and templates.
 * FORM: Polar's page columns and catalog density inside Misty; no Spaces navigation.
 * SIGNATURE: The conversation stays mounted across catalogs.
 * BOUNDARY: New workflow, skill, connector and window-execution UI has no backend actions.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 *   the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */
export default function NativeAgentsPage() {
  const state = useAgentsPageState();
  const actions = createAgentsPageActions(state);
  const view = deriveAgentsPageView(state, actions);
  const {
    user,
    spaceId,
    loading,
    profile,
    conversation,
    working,
    access,
    guard,
    workspacePage,
    settingsModalOpen,
    settingsModalTab,
    settingsModalMode,
    setSettingsModalOpen,
    setWorkspacePage,
    setChatRevision,
    setParams,
    agentConversations,
    activity,
    activeConversationId,
    workspaceRef,
    identityRef,
    recipientInputRef,
  } = state;
  const { change, setEditorStatus } = guard;
  const { openSettingsModal, select, closeSettings, saveProfile, removeProfile, openApps } =
    actions;
  const profileSection = (onDone: () => void) =>
    profile && (
      <AgentProfileSection
        key={`${user?.id}:${profile.id}:${spaceId}`}
        profile={profile}
        conversation={conversation}
        working={working}
        onStatusChange={setEditorStatus}
        onTalk={onDone}
        spaceId={spaceId}
        onSaved={saveProfile}
        onRemoved={removeProfile}
      />
    );
  const { showWorkspace, switcher } = view;
  const taskContent = <AgentsTaskContent state={state} actions={actions} view={view} />;
  return (
    <main ref={workspaceRef} className="agents-workspace" data-settings-open={settingsModalOpen}>
      {/* Review panel for a project's changes, opened from answers and Projects. */}
      <ProjectReviewSheet />
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
            change(() => {
              setWorkspacePage(page);
            }, false)
          }
          onNewTask={() => select(profile.id, true)}
          onConversation={(id) => select(profile.id, false, id)}
          onUseTemplate={(prompt) => select(profile.id, true, undefined, prompt)}
          onStartWork={(action) =>
            change(() => {
              setChatRevision((n) => n + 1);
              setWorkspacePage("task");
              setParams({ agent: profile.id });
              action();
            })
          }
          onCompanion={() => openSettingsModal("companion")}
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
        {settingsModalMode === "edit" && profileSection(closeSettings)}
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
          if (recipientInputRef.current?.isConnected) recipientInputRef.current.focus();
          else if (workspacePage !== "task")
            workspaceRef.current
              ?.querySelector<HTMLButtonElement>('.agent-studio-sidebar [aria-current="page"]')
              ?.focus();
          else identityRef.current?.focus();
        }}
      />
    </main>
  );
}
