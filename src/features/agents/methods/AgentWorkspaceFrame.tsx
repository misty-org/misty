import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { SquarePen } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { MistyActivityEntry } from "../conversations/state/activity";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, Skeleton } from "@/shared/ui";
import { MultirunButton } from "../multirun/MultirunButton";
import { SessionGoalButton } from "../goals/SessionGoalButton";
import { useSessionGoalRunner } from "../goals/sessionGoals";
import { VirtualStudio } from "../virtual/VirtualStudio";
import { ContextRail } from "../context-panel/ContextRail";
import { useContextPanel } from "../context-panel/contextPanelStore";
import { isUnread, markConversationRead } from "./conversationReads";
import { IntegrationsPage } from "../connected-apps/IntegrationsPage";
import { TutorPage } from "../tutor/TutorPage";
import "./agentWorkspaceCatalog.css";
import "./agentWorkspaceFrame.css";

/** Queued or working: read state doesn't apply yet. */
const isRunInProgress = (state?: string) => state === "running" || state === "queued";

const AgentContextPanel = lazy(async () => ({
  default: (await import("../context-panel/AgentContextPanel")).AgentContextPanel,
}));

export type AgentWorkspacePage = "task" | "integrations" | "studio" | "lab";
type RecentConversation = {
  id: string;
  title?: string;
  folderId?: string;
  updatedAt: string;
  lastReadAt?: string;
};

/**
 * The Agents page: a chat with its agent, or one of the pages the sidebar opens (studio, notebooks,
 * and integrations from the studio). Only the chat has a bar, naming the chat's agent and holding
 * the context panel for the folder's files, changes and a terminal. The other pages have no title
 * bar, since the sidebar and the tab already name them, and the studio, where agents are hired and
 * set up, floats its few buttons over the room. The
 * chats are listed in the window's sidebar, so this page has no list of its own. Presentation
 * only: conversation and account actions remain owned by AgentsPage.
 */
export function AgentWorkspaceFrame({
  agent,
  page,
  conversations,
  activity,
  conversationId,
  disabled,
  title,
  children,
  onPageChange,
  onNewTask,
  onConversation,
  onLearn,
  onAgentSettings,
}: {
  agent: AgentProfile;
  page: AgentWorkspacePage;
  conversations: RecentConversation[];
  /** This agent's runs, to mark the open conversation read once its run settles. */
  activity: MistyActivityEntry[];
  conversationId: string;
  disabled: boolean;
  /** The open chat's title. The tab names its agent, so the chat doesn't. */
  title: ReactNode;
  children: ReactNode;
  onPageChange(page: AgentWorkspacePage): void;
  onNewTask(): void;
  onConversation(id: string): void;
  /** Starts a Teach chat that opens with this request. */
  onLearn(prompt: string): void;
  /** Opens an agent's settings, from its desk in the studio. */
  onAgentSettings(agentId: string): void;
}) {
  // The open conversation is read once its run settles while the window is in view.
  const activeId = page === "task" ? conversationId : undefined;
  let latest: MistyActivityEntry | undefined;
  for (const entry of activity) {
    if (entry.parent_run_id || entry.conversation_id !== activeId) continue;
    if (!latest || entry.updated_at > latest.updated_at) latest = entry;
  }
  const lastReadAt = conversations.find((item) => item.id === activeId)?.lastReadAt;
  const readable = Boolean(
    latest && isUnread(latest.updated_at, lastReadAt) && !isRunInProgress(latest.state),
  );
  useEffect(() => {
    if (!activeId || !readable) return;
    const read = () => {
      if (document.visibilityState === "visible") markConversationRead(activeId);
    };
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [activeId, readable]);
  const [, setParams] = useSearchParams();
  useSessionGoalRunner(activeId ?? "");
  const panel = useContextPanel((state) => state.tab);
  return (
    <div className="agent-studio" data-page={page}>
      {page === "task" ? (
        <header className="agent-studio-bar" data-window-toolbar>
          {title}
          <div className="agent-studio-panels">
            <IconButton label="New task" disabled={disabled} onClick={onNewTask}>
              <SquarePen size={16} />
            </IconButton>
            <MultirunButton agentId={agent.id} onPage={onPageChange} onChat={onConversation} />
            <SessionGoalButton conversationId={conversationId} />
          </div>
        </header>
      ) : null}
      <div className="agent-studio-body">
        <div className="agent-studio-canvas">
          {/* Keep the live conversation mounted while browsing other views; its draft and voice state belong to it. */}
          <div className="agent-studio-task" hidden={page !== "task"}>
            {children}
          </div>
          {page === "lab" ? (
            <TutorPage
              agentId={agent.id}
              onLesson={(agentId, id) => {
                onPageChange("task");
                if (agentId === agent.id) onConversation(id);
                else setParams({ agent: agentId, conversation: id });
              }}
              onLearn={onLearn}
            />
          ) : null}
          {page === "studio" ? (
            <VirtualStudio
              onAgentSettings={onAgentSettings}
              onOpenChat={(agentId, chat) => {
                onPageChange("task");
                if (agentId === agent.id && chat) onConversation(chat);
                else setParams(chat ? { agent: agentId, conversation: chat } : { agent: agentId });
              }}
            />
          ) : null}
          <div className="agent-studio-catalog-host" hidden={page !== "integrations"}>
            <div className="agent-studio-pages integrations">
              <div className="agent-studio-page-scroll">
                <IntegrationsPage />
              </div>
            </div>
          </div>
        </div>
        {panel && page === "task" ? (
          <aside
            className="agent-studio-context context-panel"
            aria-label="Context"
            data-panel={panel}
          >
            <Suspense
              fallback={
                <div className="grid gap-2 p-3" aria-hidden="true">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                </div>
              }
            >
              <AgentContextPanel tab={panel} conversationId={conversationId} agent={agent} />
            </Suspense>
          </aside>
        ) : null}
        {page === "task" ? <ContextRail /> : null}
      </div>
    </div>
  );
}
