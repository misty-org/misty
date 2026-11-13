import { useAgentAccountId } from "../personal/agentAccount";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAgentAccess } from "../personal/AgentAccess";
import type { AgentSettingsTab } from "../personal/AgentSettingsModal";
import type { AgentVoiceControl } from "../conversations/view/AgentWorkspaceConversation";
import { useAgentFolderSync } from "../shared-folders/useAgentFolderSync";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { useAgentActivity } from "./useAgentActivity";
import { useAgentChangeGuard } from "./useAgentChangeGuard";
import type { AgentWorkspacePage } from "../methods/AgentWorkspaceFrame";
import { useViewConversation, useViewTitle } from "./useViewConversation";

/*
 * Page state for the Agents page: selection, settings modal, workspace page and the
 * effects that keep them in step with the URL, the account and the active conversation.
 */
export function useAgentsPageState() {
  const accountId = useAgentAccountId();
  const spaceId = "";
  const voiceRef = useRef<AgentVoiceControl>(null);
  const [, setVoiceState] = useState({ recording: false, busy: false });
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [params, setParams] = useSearchParams();
  const workspaceRef = useRef<HTMLElement>(null);
  // Links: ?view=studio, integrations or lab open that page; anything else the task.
  const linkedView = params.get("view") ?? "";
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<AgentSettingsTab>("settings");
  const [settingsModalMode, setSettingsModalMode] = useState<"edit" | "create">("edit");
  const [chatRevision, setChatRevision] = useState(0);
  const [workspacePage, setWorkspacePage] = useState<AgentWorkspacePage>(
    () => pageFromView(linkedView) ?? "task",
  );
  const [draftSeed, setDraftSeed] = useState({ agentId: "", text: "" });
  const working = useMistyStore((s) => s.working);
  const guard = useAgentChangeGuard();
  const workingAgentId = useMistyStore((s) => s.selectedAgentId);
  const conversations = useMistyStore((s) => s.conversations);
  // The chat surface doesn't change with the conversation's Space.
  const conversationSpaceId = "";
  useEffect(() => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    void load(accountId);
  }, [accountId, load]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(accountId);
    void store.loadConversations();
  }, [accountId]);
  useAgentFolderSync(accountId);
  // The agent whose chat is on screen, so a link back to it doesn't start the chat over.
  const shownAgentId = useRef<string | undefined>(undefined);
  const linkedAgentId = params.get("agent");
  const linkedConversationId = params.get("conversation");
  // A link that asks for a new chat; its value only tells one ask from the next.
  const linkedNew = params.get("new");
  // Declared before the link below: a view that gains focus hands the store its chat first.
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
    // Another view has the store: the link only changes what this one shows.
    if (!isFocused()) {
      if (linkedNew || linkedConversationId)
        applyUnfocusedLink(linkedNew ? "" : (linkedConversationId ?? ""));
      return;
    }
    // Back from another page to the chat already open: keep it mounted, draft and all.
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
    if (!sameAgent && (current.working || current.query.trim())) {
      setSelected(current.selectedAgentId ?? linkedAgentId);
      return;
    }
    const resume =
      linkedConversationId ??
      (linkedNew && !current.working ? "" : undefined) ??
      (sameAgent
        ? current.activeConversationId
        : ([...current.conversations]
            .filter((c) => c.agentId === linkedAgentId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? ""));
    useMistyStore.setState({ selectedAgentId: linkedAgentId, activeConversationId: resume });
    if (needsLoad && !current.working)
      void useMistyStore.getState().selectConversation(linkedConversationId);
    // The account settles after a reload (signed out scope, then the person's), and switching it
    // clears the open chat, so the link is applied again for the account that is now in place.
  }, [accountId, linkedAgentId, linkedConversationId, linkedNew, isFocused, applyUnfocusedLink]);
  // The sidebar opens Studio and Tutor by link; a link naming a page wins over the chat.
  // Leaving a page's link for one without a view goes back to the chat.
  const viewed = useRef(linkedView);
  useEffect(() => {
    const page = pageFromView(linkedView);
    if (page) setWorkspacePage(page);
    else if (pageFromView(viewed.current)) setWorkspacePage("task");
    viewed.current = linkedView;
  }, [linkedView]);
  // With no agent in the URL, reopen the last-used agent, then one on the person's
  // own engines, then Misty.
  const profile =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.id === workingAgentId) ??
    agents.find((a) => a.engine && a.enabled) ??
    agents.find((a) => a.system_managed) ??
    agents[0];
  useEffect(() => {
    shownAgentId.current = profile?.id;
  });
  const access = useAgentAccess(
    accountId,
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
  useViewTitle(
    viewConversation.viewId,
    workspacePage === "task"
      ? conversation?.title.trim() || "New chat"
      : workspacePageTitles[workspacePage],
  );
  // Feeds the Recents status dots.
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
  studio: "Studio",
  integrations: "Integrations",
  lab: "Lab",
};

/** The page a link's ?view= opens; the earlier office opens the studio, and tutor or notebooks the Lab. */
function pageFromView(view: string): AgentWorkspacePage | undefined {
  if (view === "office") return "studio";
  if (view === "tutor" || view === "notebooks") return "lab";
  if (view === "studio" || view === "integrations" || view === "lab") return view;
  return undefined;
}
