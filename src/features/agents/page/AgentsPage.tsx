import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  PaneLoading,
  cn,
  composerDockClass,
  FramedBar,
  FramedPage,
  EmptyState,
  ErrorState,
  Separator,
  Skeleton,
  SkeletonControl,
  Surface,
} from "@misty/ui";
import { AgentSettingsModal } from "../personal/AgentSettingsModal";
import { AgentSetup } from "../personal/AgentSetup";
import { AgentEditor } from "../personal/AgentEditor";
import { AgentDiscardDialog } from "./AgentDiscardDialog";
import { AgentWorkspaceFrame } from "../methods/AgentWorkspaceFrame";
import { AgentsTaskContent, AgentsTaskHeader } from "./AgentsTaskContent";
import { AgentStudioBar } from "./AgentConversationHeading";
import { createAgentsPageActions, deriveAgentsPageView } from "./agents_page_actions";
import { useAgentsPageState } from "./use_agents_page_state";
import { homeSpaceOf } from "../personal/agent_home_space";
import { AgentAvatar } from "../personal/AgentAvatar";
import { SharedThreadView } from "../threads/SharedThreadView";
import { useOthersThreads } from "../threads/agent_threads";

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
  const openThread = state.params.get("thread") ?? "";
  const agentSpace = profile ? homeSpaceOf(user?.id ?? "", profile) : "";
  const others = useOthersThreads(agentSpace, profile?.id ?? "", user?.id ?? "");
  const pickedThread = others.others?.find((thread) => thread.id === openThread);
  const theirs =
    !openThread || !profile ? undefined : pickedThread ? (
      <SharedThreadView
        spaceId={agentSpace}
        thread={pickedThread}
        agentName={profile.name}
        agentAvatar={<AgentAvatar agent={profile} />}
      />
    ) : others.others !== null ? (
      <EmptyState
        title="This thread is gone"
        line="It was removed, or it isn't shared in this Space."
        action={{ label: "New thread", onClick: () => select(profile.id, true) }}
      />
    ) : others.failed ? (
      <ErrorState
        title="This thread couldn't load"
        line="Check your connection and try again."
        action={{ label: "Try again", icon: RotateCw, onClick: others.reload }}
      />
    ) : (
      <PaneLoading label="Loading this thread" />
    );
  const taskContent = <AgentsTaskContent state={state} actions={actions} />;
  const taskHeader =
    pickedThread && view.showWorkspace ? (
      <AgentStudioBar agent={profile} />
    ) : (
      <AgentsTaskHeader state={state} view={view} />
    );
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
        <AgentWorkspaceFrame
          key={user?.id}
          agent={profile}
          accountId={user.id}
          page={workspacePage}
          conversations={agentConversations}
          activity={activity.entries}
          conversationId={activeConversationId}
          disabled={view.disabled}
          header={taskHeader}
          onNewTask={() => select(profile.id, true)}
          theirs={theirs}
        >
          {taskContent}
        </AgentWorkspaceFrame>
      ) : loading && !profile ? (
        <AgentsPageSkeleton chat={Boolean(activeConversationId)} />
      ) : (
        <FramedPage header={taskHeader}>{taskContent}</FramedPage>
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
      <div className="flex min-h-0 min-w-0 flex-1" aria-hidden="true">
        <FramedPage header={<FramedBar start={<Skeleton className="h-3.5 w-40" />} />}>
          <div className="flex flex-1 flex-col justify-end px-4 pt-4 pb-6">
            {chat ? (
              <div className="grid gap-4">
                {replyWidths.slice(0, 3).map((width, index) => (
                  <div key={index} className="flex gap-4">
                    <Skeleton className="size-10 flex-none rounded-full" />
                    <div className="grid flex-1 content-start gap-2 pt-1">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className={cn("h-3.5", width)} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid justify-items-start gap-2">
                <Skeleton className="mb-2 size-16 rounded-full" />
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-3.5 w-72" />
              </div>
            )}
          </div>
          <div className={composerDockClass}>{composer}</div>
        </FramedPage>
      </div>
      <Separator orientation="vertical" />
      <Surface tone="sidebar" className="flex min-h-0 flex-none" aria-hidden="true">
        <div className="flex flex-none flex-col gap-1 px-3 pt-[calc((var(--ui-header)-var(--spacing)*8)/2)] pb-2">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonControl key={index} kind="icon" />
          ))}
        </div>
      </Surface>
    </div>
  );
}
