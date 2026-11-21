import { useEffect, useState } from "react";
import { cn, Skeleton, SkeletonControl, Surface, windowToolbarClass } from "@misty/ui";
import { AgentSettingsModal } from "../personal/AgentSettingsModal";
import { AgentSetup } from "../personal/AgentSetup";
import { AgentEditor } from "../personal/AgentEditor";
import { AgentDiscardDialog } from "./AgentDiscardDialog";
import { AgentWorkspaceFrame } from "../methods/AgentWorkspaceFrame";
import {
  AgentsTaskContent,
  chatColumnClass,
  floatingHeaderClass,
  studioBarClass,
} from "./AgentsTaskContent";
import { createAgentsPageActions, deriveAgentsPageView } from "./agentsPageActions";
import { useAgentsPageState } from "./useAgentsPageState";

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
    setParams,
    agentConversations,
    activity,
    activeConversationId,
    workspaceRef,
    agents,
    load,
  } = state;
  const { setEditorStatus } = guard;
  const { select, closeSettings, saveProfile, removeProfile, openConnections } = actions;
  // A link opens any agent's settings (?agentSettings=<id>) without moving the page to that
  // agent's chat.
  const [editingId, setEditingId] = useState<string>();
  useEffect(() => {
    if (!settingsModalOpen) setEditingId(undefined);
  }, [settingsModalOpen]);
  const { openSettingsModal } = actions;
  const linkedSettings = state.params.get("agentSettings");
  useEffect(() => {
    if (!linkedSettings || !agents.some((agent) => agent.id === linkedSettings)) return;
    setEditingId(linkedSettings);
    openSettingsModal("settings");
    const next = new URLSearchParams(state.params);
    next.delete("agentSettings");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link, when its agent is known
  }, [linkedSettings, agents]);
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
          accountId={user.id}
          page={workspacePage}
          conversations={agentConversations}
          activity={activity.entries}
          conversationId={activeConversationId}
          disabled={view.disabled}
          onNewTask={() => select(profile.id, true)}
        >
          {taskContent}
        </AgentWorkspaceFrame>
      ) : loading && !profile ? (
        <AgentsPageSkeleton chat={Boolean(activeConversationId)} />
      ) : (
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
            onConnections={openConnections}
            onStatusChange={setEditorStatus}
            onSaved={saveProfile}
          />
        )}
      </AgentSettingsModal>
      <AgentDiscardDialog open={guard.pending} onCancel={guard.cancel} onDiscard={guard.discard} />
    </Surface>
  );
}

const replyWidths = ["w-3/4", "w-full", "w-5/6", "w-2/3", "w-full", "w-1/2"];

/**
 * The page before the person's agents are read: the chat under its bar beside the panels' rail.
 * An open chat shows lines of its conversation over the composer; a new one, the greeting over it.
 */
function AgentsPageSkeleton({ chat }: { chat: boolean }) {
  const composer = <Skeleton className="h-28 w-full rounded-xl" />;
  return (
    <div
      role="status"
      aria-label="Agents"
      aria-busy="true"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-row"
    >
      <span className="sr-only">Agents</span>
      <Surface tone="page" className="relative min-h-0 min-w-90 flex-1 overflow-hidden">
        <div className={cn(chatColumnClass, "h-full")} aria-hidden="true">
          <div
            className={cn(
              "agent-studio-bar",
              floatingHeaderClass,
              studioBarClass,
              windowToolbarClass,
            )}
          >
            <Skeleton className="h-3.5 w-40" />
          </div>
          {chat ? (
            <>
              <div className="mx-auto grid w-full max-w-209 flex-1 content-start gap-2.5 px-6 pt-[calc(var(--agent-conversation-inset)+--spacing(4))]">
                {replyWidths.map((width, index) => (
                  <Skeleton key={index} className={cn("h-3.5", width)} />
                ))}
              </div>
              <div className="mx-auto w-full max-w-209 px-6 pt-3 pb-4">{composer}</div>
            </>
          ) : (
            <div className="mx-auto flex w-168 max-w-[calc(100%-var(--spacing)*12)] flex-col items-center pt-[clamp(--spacing(10),18vh,--spacing(52.5))]">
              <Skeleton className="mb-5 h-7 w-2/3" />
              {composer}
            </div>
          )}
        </div>
      </Surface>
      <div
        className="flex flex-none flex-col gap-1 px-3 pt-[calc((var(--ui-header)-var(--spacing)*8)/2)] pb-2"
        aria-hidden="true"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonControl key={index} kind="icon" />
        ))}
      </div>
    </div>
  );
}
