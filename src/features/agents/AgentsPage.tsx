import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./agentsWorkspace.css";
import { AgentSettingsModal, type AgentSettingsTab } from "./components/AgentSettingsModal";
import { AgentSetup } from "./components/AgentSetup";
import { AgentSwitcher } from "./components/AgentSwitcher";
import { useAgentAccess } from "./components/AgentAccess";
import {
  AgentWorkspaceConversation,
  type AgentVoiceControl,
} from "./components/AgentWorkspaceConversation";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { AgentDeviceTargets } from "./page/AgentDeviceTargets";
import { AgentConversationHeading } from "./page/AgentConversationHeading";
import { AgentDiscardDialog } from "./page/AgentDiscardDialog";
import { AgentLanding } from "./page/AgentLanding";
import { AgentNewChat } from "./page/AgentNewChat";
import { AgentProfileSection } from "./page/AgentProfileSection";
import { AgentDetailsPanel, type AgentDetailsSectionId } from "./page/AgentDetailsPanel";
import { agentDetailsSections } from "./page/AgentDetailsSections";
import { useAgentActivity } from "./page/useAgentActivity";
import { useAgentChangeGuard } from "./page/useAgentChangeGuard";
import { useAgentFolderSync } from "./folders/useAgentFolderSync";
import { AgentWorkspaceFrame, type AgentWorkspacePage } from "./workspace/AgentWorkspaceFrame";

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
  const { user } = useAuth();
  const spaceId = "";
  const voiceRef = useRef<AgentVoiceControl>(null);
  const [, setVoiceState] = useState({ recording: false, busy: false });
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [newChat, setNewChat] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [params, setParams] = useSearchParams();
  // Details stays open, on its section and at its width, across conversations until
  // the person closes it.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsSection, setDetailsSection] = useState<AgentDetailsSectionId>("task");
  const [detailsWidth, setDetailsWidth] = useState(320);
  const workspaceRef = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLButtonElement>(null);
  const recipientInputRef = useRef<HTMLInputElement>(null);
  // Links: ?view=workflows (and the retired scheduled view) open Workflows;
  // ?view=activity (and automations) open Activity.
  const linkedView = params.get("view") ?? "";
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<AgentSettingsTab>("settings");
  const [settingsModalMode, setSettingsModalMode] = useState<"edit" | "create">("edit");
  const [chatRevision, setChatRevision] = useState(0);
  const [workspacePage, setWorkspacePage] = useState<AgentWorkspacePage>(() =>
    ["workflows", "scheduled"].includes(linkedView)
      ? "workflows"
      : ["activity", "automations"].includes(linkedView)
        ? "activity"
        : "task",
  );
  const [draftSeed, setDraftSeed] = useState({ agentId: "", text: "" });
  const working = useMistyStore((s) => s.working);
  const guard = useAgentChangeGuard(working);
  const { change, setEditorStatus } = guard;
  const workingAgentId = useMistyStore((s) => s.selectedAgentId);
  const conversations = useMistyStore((s) => s.conversations);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const conversationSpaceId =
    conversations.find((c) => c.id === activeConversationId)?.spaceId ?? "";
  useEffect(() => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    if (!user?.id) {
      void load("");
      return;
    }
    return observeAccountChanges(user.id, ["agents"], () => load(user.id));
  }, [user?.id, load]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(user?.id ?? "");
    if (user?.id) void store.loadConversations();
  }, [user?.id]);
  useAgentFolderSync(user?.id ?? "");
  const linkedAgentId = params.get("agent");
  const linkedConversationId = params.get("conversation");
  useEffect(() => {
    if (!linkedAgentId) return;
    setSelected(linkedAgentId);
    setNewChat(false);
    setWorkspacePage("task");
    setChatRevision((n) => n + 1);
    const needsLoad =
      linkedConversationId &&
      useMistyStore.getState().activeConversationId !== linkedConversationId;
    const current = useMistyStore.getState();
    const sameAgent = current.selectedAgentId === linkedAgentId;
    if (!sameAgent && (current.working || current.query.trim())) {
      setSelected(current.selectedAgentId ?? linkedAgentId);
      return;
    }
    const resume =
      linkedConversationId ??
      (sameAgent
        ? current.activeConversationId
        : ([...current.conversations]
            .filter((c) => c.agentId === linkedAgentId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? ""));
    useMistyStore.setState({ selectedAgentId: linkedAgentId, activeConversationId: resume });
    if (needsLoad && !current.working)
      void useMistyStore.getState().selectConversation(linkedConversationId);
  }, [linkedAgentId, linkedConversationId]);
  // With no agent in the URL, reopen the last-used agent, then Misty, then the first agent.
  const profile =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.id === workingAgentId) ??
    agents.find((a) => a.system_managed) ??
    agents[0];
  const access = useAgentAccess(
    user?.id ?? "",
    settingsModalOpen && settingsModalMode === "create" ? undefined : profile?.id,
  );
  const accessRetry = access.retry;
  const previousWorkspacePage = useRef(workspacePage);
  useEffect(() => {
    if (previousWorkspacePage.current === "integrations" && workspacePage !== "integrations")
      accessRetry();
    previousWorkspacePage.current = workspacePage;
  }, [workspacePage, accessRetry]);
  const agentConversations = conversations.filter(
    (c) => c.agentId === profile?.id || (!c.agentId && profile?.system_managed),
  );
  const conversation = agentConversations.find((c) => c.id === activeConversationId);
  // One subscription feeds both the Task section and the Recents status icons.
  const activity = useAgentActivity(user?.id ?? "", profile?.id);
  const openSettingsModal = (tab: AgentSettingsTab = "settings") =>
    change(() => {
      setSettingsModalMode("edit");
      setSettingsModalTab(tab);
      setSettingsModalOpen(true);
    }, false);
  const select = (id: string, startNew = false, conversationId?: string, prompt = "") =>
    change(() => {
      setChatRevision((n) => n + 1);
      setSelected(id);
      setVoiceState({ recording: false, busy: false });
      setNewChat(false);
      setWorkspacePage("task");
      setDraftSeed({ agentId: id, text: prompt });
      setSettingsModalOpen(false);
      const nextConversationId = startNew ? "" : (conversationId ?? "");
      const next = new URLSearchParams(params);
      next.set("agent", id);
      if (nextConversationId) next.set("conversation", nextConversationId);
      else next.delete("conversation");
      setParams(next, { replace: true });
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: nextConversationId,
        query: prompt,
        context: [],
        handoff: undefined,
        browserRequest: undefined,
      });
      if (nextConversationId) void useMistyStore.getState().selectConversation(nextConversationId);
    });
  const create = () =>
    change(() => {
      setNewChat(false);
      setSettingsModalMode("create");
      setSettingsModalTab("settings");
      setSettingsModalOpen(true);
    });
  const beginNewChat = () =>
    change(() => {
      setNewChat(true);
      setRecipientSearch("");
      setSettingsModalOpen(false);
    });
  const closeSettings = () => change(() => setSettingsModalOpen(false), false);
  const toggleDetails = () => change(() => setDetailsOpen((open) => !open), false);
  const openTaskDetails = () =>
    change(() => {
      setDetailsOpen(true);
      setDetailsSection("task");
    }, false);
  const saveProfile = async (id: string, companion = false) => {
    await load(user?.id ?? "");
    setSelected(id);
    if (settingsModalMode === "create") {
      setChatRevision((n) => n + 1);
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: "",
        context: [],
        handoff: undefined,
        browserRequest: undefined,
      });
    }
    setSettingsModalMode("edit");
    setSettingsModalTab(companion ? "companion" : "settings");
    setSettingsModalOpen(companion);
    guard.cancel();
  };
  const removeProfile = async () => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    await load(user?.id ?? "");
  };
  const disabled = working || guard.busy;
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
  const showWorkspace = !newChat && Boolean(profile);
  const switcher = {
    agents,
    conversations,
    selectedAgent: profile,
    conversationId: activeConversationId,
    disabled,
    restoreTriggerFocus: !guard.pending && !settingsModalOpen,
    triggerRef: identityRef,
    onSelect: select,
    onCreate: create,
    onSettings: () => openSettingsModal("settings"),
  };
  const openApps = () =>
    change(() => {
      setWorkspacePage("integrations");
    }, false);
  const openActivity = () =>
    change(() => {
      setWorkspacePage("activity");
    }, false);
  const openTemplates = () =>
    change(() => {
      setWorkspacePage("templates");
    }, false);
  const taskWorking = Boolean(
    profile && working && (workingAgentId === profile.id || Boolean(conversation)),
  );
  const showDetails = Boolean(profile) && !newChat && !settingsModalOpen;
  // Built whenever Details can show, so the closed panel stays mounted to animate.
  const sections =
    showDetails &&
    agentDetailsSections({
      activity,
      conversation,
      working: taskWorking,
      deviceName: access.device?.device?.displayName,
    });
  const taskContent = (
    <>
      <div className="agents-main">
        {/* The header rides in the chat column, so the panels run up beside the title. */}
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
              details={
                showDetails
                  ? {
                      open: detailsOpen,
                      working: taskWorking,
                      onToggle: toggleDetails,
                      onTask: openTaskDetails,
                    }
                  : undefined
              }
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
                        onActivity={openActivity}
                        onTemplates={openTemplates}
                      />
                    </>
                  ) : undefined
                }
                onCreate={create}
              />
            )}
          </div>
          {sections && (
            <AgentDetailsPanel
              open={detailsOpen}
              sections={sections}
              section={detailsSection}
              width={detailsWidth}
              onSection={setDetailsSection}
              onClose={toggleDetails}
              onWidthChange={setDetailsWidth}
            />
          )}
        </div>
      </div>
    </>
  );
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
          disabled={disabled}
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
