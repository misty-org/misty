import type { AgentSettingsTab } from "../personal/AgentSettingsModal";
import { useMistyStore } from "../conversations/state/useMistyStore";
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
    setWorkspacePage,
    setDraftSeed,
    setSettingsModalOpen,
    setSettingsModalMode,
    setSettingsModalTab,
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
      setWorkspacePage("task");
      setDraftSeed({ agentId: id, text: prompt });
      setSettingsModalOpen(false);
      const nextConversationId = startNew ? "" : (conversationId ?? "");
      const next = new URLSearchParams(params);
      next.set("agent", id);
      next.delete("view");
      if (nextConversationId) next.set("conversation", nextConversationId);
      else next.delete("conversation");
      setParams(next, { replace: true });
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: nextConversationId,
        query: prompt,
        context: [],
        handoff: undefined,
      });
      if (nextConversationId) void useMistyStore.getState().selectConversation(nextConversationId);
    });
  const create = () =>
    change(() => {
      setSettingsModalMode("create");
      setSettingsModalTab("settings");
      setSettingsModalOpen(true);
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
  // Pages are links, so the sidebar shows where the person is.
  const openPage = (page: "studio" | "integrations" | "tutor") =>
    change(() => {
      setWorkspacePage(page);
      const next = new URLSearchParams(params);
      next.set("view", page);
      setParams(next);
    }, false);
  const openApps = () => openPage("integrations");
  return {
    openSettingsModal,
    select,
    create,
    closeSettings,
    saveProfile,
    removeProfile,
    openApps,
    openPage,
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
    guard,
    settingsModalOpen,
    identityRef,
  } = state;
  // Agents keep working in their own chats while the person switches between them
  // only an unsaved change holds the page.
  const disabled = guard.busy;
  const showWorkspace = Boolean(profile);
  const switcher = {
    agents,
    conversations,
    selectedAgent: profile,
    conversationId: activeConversationId,
    disabled,
    restoreTriggerFocus: !guard.pending && !settingsModalOpen,
    triggerRef: identityRef,
    onSelect: actions.select,
    onSettings: (agentId: string) => {
      if (agentId !== profile?.id) actions.select(agentId);
      actions.openSettingsModal("settings");
    },
  };
  return { disabled, showWorkspace, switcher };
}

export type AgentsPageView = ReturnType<typeof deriveAgentsPageView>;
