import { lazy, Suspense, useEffect, type ReactNode } from "react";
import {
  Armchair,
  FolderTree,
  GitCompareArrows,
  MessageSquare,
  MonitorPlay,
  Repeat2,
  SquarePen,
  SquareTerminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { MistyActivityEntry } from "../conversations/state/activity";
import type { AgentProfile } from "@/shared/schemas";
import { Button, IconButton, Skeleton } from "@/shared/ui";
import { ConnectAgentButton } from "../engines/ConnectAgentDialog";
import { MultirunButton } from "../multirun/MultirunButton";
import { SessionGoalButton } from "../goals/SessionGoalButton";
import { useSessionGoalRunner } from "../goals/sessionGoals";
import { VirtualOffice } from "../virtual/VirtualOffice";
import { useContextPanel, type ContextPanelTab } from "../context-panel/contextPanelStore";
import { isUnread, markConversationRead } from "./conversationReads";
import { isRunInProgress } from "./RecentStatusBadge";
import { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog";
import "./agentWorkspaceCatalog.css";
import "./agentWorkspaceFrame.css";

const AgentContextPanel = lazy(async () => ({
  default: (await import("../context-panel/AgentContextPanel")).AgentContextPanel,
}));

export type AgentWorkspacePage = "task" | "workflows" | "integrations" | "office";
type RecentConversation = {
  id: string;
  title?: string;
  folderId?: string;
  updatedAt: string;
  lastReadAt?: string;
};

const pages: [AgentWorkspacePage, string, LucideIcon][] = [
  ["task", "Chat", MessageSquare],
  ["office", "Office", Armchair],
  ["workflows", "Workflows", Repeat2],
  ["integrations", "Integrations", Waypoints],
];

const panels: [ContextPanelTab, string, LucideIcon][] = [
  ["files", "Files", FolderTree],
  ["changes", "Changes", GitCompareArrows],
  ["terminal", "Terminal", SquareTerminal],
  ["preview", "Preview", MonitorPlay],
];

/**
 * The Agents page around a chat: a bar with the agent and the page's views (chat, office,
 * workflows, integrations), the chat in the middle, and a context panel on the right for the
 * folder's files, changes and a terminal. The chats themselves are listed in the window's
 * sidebar, so this page has no list of its own. Presentation only: conversation and account
 * actions remain owned by AgentsPage.
 */
export function AgentWorkspaceFrame({
  agent,
  page,
  conversations,
  activity,
  conversationId,
  disabled,
  identity,
  children,
  onPageChange,
  onNewTask,
  onConversation,
  onUseTemplate,
  onStartWork,
}: {
  agent: AgentProfile;
  page: AgentWorkspacePage;
  conversations: RecentConversation[];
  /** This agent's runs, to mark the open conversation read once its run settles. */
  activity: MistyActivityEntry[];
  conversationId: string;
  disabled: boolean;
  /** The agent switcher. It also holds New agent and this agent's settings. */
  identity: ReactNode;
  children: ReactNode;
  onPageChange(page: AgentWorkspacePage): void;
  onNewTask(): void;
  onConversation(id: string): void;
  onUseTemplate(prompt: string): void;
  onStartWork(action: () => void): void;
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
  const togglePanel = useContextPanel((state) => state.toggle);
  return (
    <div className="agent-studio" data-page={page}>
      <header className="agent-studio-bar" data-window-toolbar>
        {identity}
        <nav className="agent-studio-views" aria-label="Agent workspace pages">
          {pages.map(([id, label, Icon]) => (
            <Button
              key={id}
              data-agent-navigation-control
              variant="ghost"
              size="sm"
              aria-current={page === id ? "page" : undefined}
              onClick={() => onPageChange(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </Button>
          ))}
        </nav>
        <div className="agent-studio-panels">
          <IconButton label="New task" disabled={disabled} onClick={onNewTask}>
            <SquarePen size={16} />
          </IconButton>
          <ConnectAgentButton />
          <MultirunButton agentId={agent.id} onPage={onPageChange} onChat={onConversation} />
          <SessionGoalButton conversationId={page === "task" ? conversationId : ""} />
          {panels.map(([id, label, Icon]) => (
            <IconButton
              key={id}
              label={label}
              aria-pressed={panel === id}
              onClick={() => togglePanel(id)}
            >
              <Icon size={16} />
            </IconButton>
          ))}
        </div>
      </header>
      <div className="agent-studio-body">
        <div className="agent-studio-canvas">
          {/* Keep the live conversation mounted while browsing other views; its draft and voice state belong to it. */}
          <div className="agent-studio-task" hidden={page !== "task"}>
            {children}
          </div>
          {page === "office" ? (
            <VirtualOffice
              onOpenChat={(agentId, chat) => {
                onPageChange("task");
                if (agentId === agent.id && chat) onConversation(chat);
                else setParams(chat ? { agent: agentId, conversation: chat } : { agent: agentId });
              }}
            />
          ) : null}
          <div
            className="agent-studio-catalog-host"
            hidden={page !== "workflows" && page !== "integrations"}
          >
            <AgentWorkspaceCatalog
              agentId={agent.id}
              agentName={agent.name}
              page={page === "integrations" ? "integrations" : "workflows"}
              onUse={onUseTemplate}
              onConversation={onConversation}
              onStartWork={onStartWork}
            />
          </div>
        </div>
        {panel ? (
          <aside className="agent-studio-context context-panel" aria-label="Context">
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
      </div>
    </div>
  );
}
