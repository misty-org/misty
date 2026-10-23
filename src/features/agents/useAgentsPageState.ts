import { observeAccountChanges } from "@/api/account-events";
import { useAuth } from "@/features/auth";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAgentAccess } from "./components/AgentAccess";
import type { AgentSettingsTab } from "./components/AgentSettingsModal";
import type { AgentVoiceControl } from "./components/AgentWorkspaceConversation";
import { useAgentFolderSync } from "./folders/useAgentFolderSync";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { useAgentActivity } from "./page/useAgentActivity";
import { useAgentChangeGuard } from "./page/useAgentChangeGuard";
import type { AgentWorkspacePage } from "./workspace/AgentWorkspaceFrame";

/*
 * Page state for the Agents page: selection, settings modal, workspace page and the
 * effects that keep them in step with the URL, the account and the active conversation.
 */
export function useAgentsPageState() {
  const { user } = useAuth();
  const spaceId = "";
  const voiceRef = useRef<AgentVoiceControl>(null);
  const [, setVoiceState] = useState({ recording: false, busy: false });
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [params, setParams] = useSearchParams();
  const workspaceRef = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLButtonElement>(null);
  // Links: ?view=workflows (and the earlier catalog, templates, scheduled and automations
  // views) open Workflows; the retired ?view=activity opens the task.
  const linkedView = params.get("view") ?? "";
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<AgentSettingsTab>("settings");
  const [settingsModalMode, setSettingsModalMode] = useState<"edit" | "create">("edit");
  const [chatRevision, setChatRevision] = useState(0);
  const [workspacePage, setWorkspacePage] = useState<AgentWorkspacePage>(() =>
    ["workflows", "catalog", "templates", "scheduled", "automations"].includes(linkedView)
      ? "workflows"
      : "task",
  );
  const [draftSeed, setDraftSeed] = useState({ agentId: "", text: "" });
  const working = useMistyStore((s) => s.working);
  const guard = useAgentChangeGuard();
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
  // Feeds the Recents status dots.
  const activity = useAgentActivity(user?.id ?? "", profile?.id);
  return {
    user,
    spaceId,
    voiceRef,
    setVoiceState,
    agents,
    loading,
    error,
    load,
    selected,
    params,
    setParams,
    workspaceRef,
    identityRef,
    settingsModalOpen,
    setSettingsModalOpen,
    settingsModalTab,
    setSettingsModalTab,
    settingsModalMode,
    setSettingsModalMode,
    chatRevision,
    setChatRevision,
    workspacePage,
    setWorkspacePage,
    draftSeed,
    setDraftSeed,
    working,
    guard,
    workingAgentId,
    conversations,
    activeConversationId,
    conversationSpaceId,
    profile,
    access,
    conversation,
    agentConversations,
    activity,
    setSelected,
  };
}

export type AgentsPageState = ReturnType<typeof useAgentsPageState>;
