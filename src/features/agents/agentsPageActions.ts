import type { AgentSettingsTab } from "./components/AgentSettingsModal";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentsPageState } from "./useAgentsPageState";

/* Actions for the Agents page. Each runs through the change guard so unsaved edits are confirmed first. */
export function createAgentsPageActions(state: AgentsPageState) {
  const {
    user,
    params,
    setParams,
    setChatRevision,
    setSelected,
    setVoiceState,
    setNewChat,
    setWorkspacePage,
    setDraftSeed,
    setSettingsModalOpen,
    setSettingsModalMode,
    setSettingsModalTab,
    setRecipientSearch,
    settingsModalMode,
    load,
    guard,
  } = state;
  const { change } = guard;
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
  const openApps = () =>
    change(() => {
      setWorkspacePage("integrations");
    }, false);
  const openTemplates = () =>
    change(() => {
      setWorkspacePage("templates");
    }, false);
  return {
    openSettingsModal,
    select,
    create,
    beginNewChat,
    closeSettings,
    saveProfile,
    removeProfile,
    openApps,
    openTemplates,
  };
}

export type AgentsPageActions = ReturnType<typeof createAgentsPageActions>;

/* Derived props shared by the page header, the workspace frame and the task content. */
export function deriveAgentsPageView(state: AgentsPageState, actions: AgentsPageActions) {
  const {
    agents,
    conversations,
    profile,
    activeConversationId,
    working,
    workingAgentId,
    conversation,
    guard,
    newChat,
    settingsModalOpen,
    identityRef,
  } = state;
  const disabled = working || guard.busy;
  const showWorkspace = !newChat && Boolean(profile);
  const switcher = {
    agents,
    conversations,
    selectedAgent: profile,
    conversationId: activeConversationId,
    disabled,
    restoreTriggerFocus: !guard.pending && !settingsModalOpen,
    triggerRef: identityRef,
    onSelect: actions.select,
    onCreate: actions.create,
    onSettings: () => actions.openSettingsModal("settings"),
  };
  const taskWorking = Boolean(
    profile && working && (workingAgentId === profile.id || Boolean(conversation)),
  );
  return { disabled, showWorkspace, switcher, taskWorking };
}

export type AgentsPageView = ReturnType<typeof deriveAgentsPageView>;
