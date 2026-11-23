import type { AgentSettingsTab } from "../personal/AgentSettingsModal";
import { useMistyStore } from "../conversations/state/use_misty_store";
import type { AgentsPageState } from "./use_agents_page_state";
import type { AgentWorkspacePage } from "../methods/AgentWorkspaceFrame";
import { openAgentsHub } from "../hub/agents_hub_store";

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
      next.delete("thread");
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
    await load(user.id);
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
    await load(user.id);
  };
  const openPage = (page: Exclude<AgentWorkspacePage, "task">) =>
    change(() => {
      setWorkspacePage(page);
      const next = new URLSearchParams(params);
      next.set("view", page);
      setParams(next);
    }, false);
  const openConnections = () => openAgentsHub("connections");
  return {
    openSettingsModal,
    select,
    create,
    closeSettings,
    saveProfile,
    removeProfile,
    openConnections,
    openPage,
  };
}

export type AgentsPageActions = ReturnType<typeof createAgentsPageActions>;

export function deriveAgentsPageView(state: AgentsPageState) {
  const disabled = state.guard.busy;
  const showWorkspace = Boolean(state.profile);
  return { disabled, showWorkspace };
}

export type AgentsPageView = ReturnType<typeof deriveAgentsPageView>;
