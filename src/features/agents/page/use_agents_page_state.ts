import { useShallow } from "zustand/react/shallow";
import { useMistyWhileShown } from "../conversations/state/use_misty_while_shown";
import { useAgentAccountId } from "../personal/agent_account";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAgentAccess } from "../personal/AgentAccess";
import type { AgentSettingsTab } from "../personal/AgentSettingsModal";
import type { AgentVoiceControl } from "../conversations/view/AgentWorkspaceConversation";
import { useAgentFolderSync } from "../shared-folders/use_agent_folder_sync";
import { defaultAgentOf, usePersonalAgentsStore } from "../personal/personal_agents_store";
import { useAgentActivity } from "./use_agent_activity";
import { useAgentChangeGuard } from "./use_agent_change_guard";
import { useSettingsOpen } from "@/features/settings";
import { openAgentsHub } from "../hub/agents_hub_store";
import type { AgentWorkspacePage } from "../methods/AgentWorkspaceFrame";
import { useViewConversation, useViewTitle } from "./use_view_conversation";

export function useAgentsPageState() {
  const accountId = useAgentAccountId();
  const spaceId = "";
  const voiceRef = useRef<AgentVoiceControl>(null);
  const [, setVoiceState] = useState({ recording: false, busy: false });
  const { agents, loading, error, load } = usePersonalAgentsStore(
    useShallow((state) => ({
      agents: state.agents,
      loading: state.loading,
      error: state.error,
      load: state.load,
    })),
  );
  const [selected, setSelected] = useState<string>();
  const [params, setParams] = useSearchParams();
  const workspaceRef = useRef<HTMLElement>(null);
  const linkedView = params.get("view") ?? "";
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<AgentSettingsTab>("settings");
  const [settingsModalMode, setSettingsModalMode] = useState<"edit" | "create">("edit");
  const [chatRevision, setChatRevision] = useState(0);
  const [workspacePage, setWorkspacePage] = useState<AgentWorkspacePage>(
    () => pageFromView(linkedView) ?? "task",
  );
  const [draftSeed, setDraftSeed] = useState({ agentId: "", text: "" });
  const { working, workingAgentId, conversations } = useMistyWhileShown((s) => ({
    working: s.working,
    workingAgentId: s.selectedAgentId,
    conversations: s.conversations,
  }));
  const guard = useAgentChangeGuard();
  const conversationSpaceId = "";
  useEffect(() => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    const agentsNow = usePersonalAgentsStore.getState();
    if (agentsNow.accountId !== accountId || (!agentsNow.agents.length && !agentsNow.loading))
      void load(accountId);
  }, [accountId, load]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(accountId);
    if (accountId && !store.working && !store.conversations.length && !store.conversationsLoading)
      void store.loadConversations();
  }, [accountId]);
  useAgentFolderSync(accountId);
  const shownAgentId = useRef<string | undefined>(undefined);
  const linkedAgentId = params.get("agent");
  const linkedConversationId = params.get("conversation");
  const linkedNew = params.get("new");
  const viewConversation = useViewConversation({
    agentId: selected ?? linkedAgentId ?? undefined,
    linkedConversationId,
    linkedNew,
    params,
    setParams,
  });
  const activeConversationId = viewConversation.conversationId;
  const { isFocused, applyUnfocusedLink } = viewConversation;
  useEffect(() => {
    if (!linkedAgentId) return;
    setSelected(linkedAgentId);
    setWorkspacePage("task");
    if (!isFocused()) {
      if (linkedNew || linkedConversationId)
        applyUnfocusedLink(linkedNew ? "" : (linkedConversationId ?? ""));
      return;
    }
    const open = useMistyStore.getState();
    if (
      !linkedNew &&
      shownAgentId.current === linkedAgentId &&
      (!linkedConversationId || linkedConversationId === open.activeConversationId)
    )
      return;
    setChatRevision((n) => n + 1);
    const needsLoad =
      linkedConversationId &&
      useMistyStore.getState().activeConversationId !== linkedConversationId;
    const current = useMistyStore.getState();
    const sameAgent = current.selectedAgentId === linkedAgentId;
    const resume =
      linkedConversationId ??
      (linkedNew && !current.working ? "" : undefined) ??
      (sameAgent
        ? current.activeConversationId
        : ([...current.conversations]
            .filter((c) => c.agentId === linkedAgentId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? ""));
    useMistyStore.setState({ selectedAgentId: linkedAgentId, activeConversationId: resume });
    if (needsLoad) void useMistyStore.getState().selectConversation(linkedConversationId);
  }, [accountId, linkedAgentId, linkedConversationId, linkedNew, isFocused, applyUnfocusedLink]);
  const viewed = useRef(linkedView);
  useEffect(() => {
    const page = pageFromView(linkedView);
    if (page) setWorkspacePage(page);
    else if (pageFromView(viewed.current)) setWorkspacePage("task");
    viewed.current = linkedView;
  }, [linkedView]);
  useEffect(() => {
    if (!isStudioView(linkedView)) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("view");
        return next;
      },
      { replace: true },
    );
  }, [linkedView, setParams]);
  const profile =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.id === workingAgentId) ??
    agents.find((a) => a.engine && a.enabled) ??
    defaultAgentOf(agents) ??
    agents[0];
  useEffect(() => {
    shownAgentId.current = profile?.id;
  });
  const access = useAgentAccess(
    accountId,
    settingsModalOpen && settingsModalMode === "create" ? undefined : profile?.id,
  );
  const accessRetry = access.retry;
  const hubOpen = useSettingsOpen((state) => state.open);
  const hubWasOpen = useRef(hubOpen);
  useEffect(() => {
    if (hubWasOpen.current && !hubOpen) accessRetry();
    hubWasOpen.current = hubOpen;
  }, [hubOpen, accessRetry]);
  useEffect(() => {
    if (linkedView !== "integrations") return;
    openAgentsHub("plugins");
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("view");
        return next;
      },
      { replace: true },
    );
  }, [linkedView, setParams]);
  const agentConversations = conversations.filter(
    (c) => c.agentId === profile?.id || (!c.agentId && profile?.system_managed),
  );
  const conversation = agentConversations.find((c) => c.id === activeConversationId);
  const chatTitle = useMistyStore(
    (s) =>
      s.conversations.find(
        (c) =>
          c.id === activeConversationId &&
          (c.agentId === profile?.id || (!c.agentId && profile?.system_managed)),
      )?.title,
  );
  useViewTitle(
    viewConversation.viewId,
    workspacePage === "task"
      ? profile?.name?.trim() || chatTitle?.trim() || "New chat"
      : workspacePageTitles[workspacePage],
  );
  const activity = useAgentActivity(accountId, profile?.id);
  return {
    user: { id: accountId },
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

const workspacePageTitles: Record<Exclude<AgentWorkspacePage, "task">, string> = {
  files: "Files",
};

function pageFromView(view: string): AgentWorkspacePage | undefined {
  if (view === "files") return view;
  return undefined;
}

export const isStudioView = (view: string | null) => view === "studio" || view === "office";
