import { useMemo, type ReactNode } from "react";
import { Activity, LayoutGrid, Plug, SquarePen, Workflow } from "lucide-react";
import type { MistyActivityEntry } from "@/features/misty/activity";
import type { AgentProfile } from "@/shared/schemas";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { Button } from "@/shared/ui";
import { useAgentFoldersStore } from "../folders/agentFoldersStore";
import {
  AgentRecentConversations,
  type RecentFolder,
  type RecentStatus,
} from "./AgentRecentConversations";
import { AgentActivityPage } from "./AgentActivityPage";
import { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog";
import "./agentWorkspaceCatalog.css";
import "./agentWorkspaceFrame.css";

export type AgentWorkspacePage = "task" | "activity" | "workflows" | "templates" | "integrations";
type RecentConversation = { id: string; title?: string; folderId?: string; updatedAt: string };

/** Presentation only. Existing conversation and account actions remain owned by AgentsPage. */
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
  onCompanion,
}: {
  agent: AgentProfile;
  page: AgentWorkspacePage;
  conversations: RecentConversation[];
  /** This agent's runs; Recents shows each conversation's latest one. */
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
  onCompanion(): void;
}) {
  const allFolders = useAgentFoldersStore((state) => state.folders);
  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Rows only show ids, titles and filing; a streaming answer rewrites its conversation on
  // every token, so key the lists on what the rows show to keep the memoized list still.
  const listKey = sorted
    .map((c) => `${c.id}\u0000${c.title ?? ""}\u0000${c.folderId ?? ""}`)
    .join("\u0001");
  const folderKey = allFolders
    .filter((folder) => folder.agentId === agent.id)
    .map((folder) => `${folder.id}\u0000${folder.name}`)
    .join("\u0001");
  const { folders, recent } = useMemo(() => {
    const own = allFolders.filter((folder) => folder.agentId === agent.id);
    const filed = new Set(own.map((folder) => folder.id));
    const row = ({ id, title, folderId }: RecentConversation) => ({ id, title, folderId });
    const groups: RecentFolder[] = own.map((folder) => ({
      folder,
      conversations: sorted.filter((c) => c.folderId === folder.id).map(row),
    }));
    // A chat whose folder is gone or not loaded yet stays visible in Recents.
    const unfiled = sorted.filter((c) => !c.folderId || !filed.has(c.folderId));
    return { folders: groups, recent: unfiled.slice(0, 12).map(row) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys capture the shown fields
  }, [listKey, folderKey, agent.id]);
  // Latest top-level run per conversation, keyed on what the icons show so the memoized
  // list stays still while a run streams.
  const latestRuns = new Map<string, RecentStatus>();
  for (const entry of activity) {
    if (entry.parent_run_id || !entry.conversation_id) continue;
    const known = latestRuns.get(entry.conversation_id);
    if (!known || entry.updated_at > known.updatedAt)
      latestRuns.set(entry.conversation_id, { state: entry.state, updatedAt: entry.updated_at });
  }
  const statusKey = [...latestRuns]
    .map(([id, run]) => `${id}\u0000${run.state}\u0000${run.updatedAt}`)
    .join("\u0001");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- statusKey captures the shown fields
  const statuses = useMemo(() => Object.fromEntries(latestRuns), [statusKey]);
  const openConversation = useStableCallback(onConversation);
  return (
    <div className="agent-studio" data-page={page}>
      <aside className="agent-studio-sidebar" aria-label={`${agent.name} workspace`}>
        <header>{identity}</header>
        <nav aria-label="Agent workspace pages">
          <Button
            data-agent-navigation-control
            variant="ghost"
            justify="start"
            disabled={disabled}
            aria-current={page === "task" && !conversationId ? "page" : undefined}
            aria-label="New task"
            onClick={onNewTask}
          >
            <SquarePen size={16} />
            <span>New task</span>
          </Button>
          {(
            [
              ["activity", "Activity", Activity],
              ["workflows", "Workflows", Workflow],
              ["templates", "Templates", LayoutGrid],
              ["integrations", "Integrations", Plug],
            ] as const
          ).map(([id, label, Icon]) => (
            <Button
              data-agent-navigation-control
              key={id}
              aria-label={label}
              variant="ghost"
              justify="start"
              aria-current={page === id ? "page" : undefined}
              onClick={() => onPageChange(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </Button>
          ))}
        </nav>
        <AgentRecentConversations
          agentId={agent.id}
          folders={folders}
          recent={recent}
          statuses={statuses}
          activeId={page === "task" ? conversationId : undefined}
          disabled={disabled}
          onConversation={openConversation}
        />
      </aside>
      <div className="agent-studio-canvas">
        {/* Keep the live conversation mounted while browsing catalogs; its draft and voice state belong to it. */}
        <div className="agent-studio-task" hidden={page !== "task"}>
          {children}
        </div>
        <div className="agent-studio-catalog-host" hidden={page === "task"}>
          {page === "activity" ? (
            <AgentActivityPage />
          ) : (
            <AgentWorkspaceCatalog
              agentId={agent.id}
              agentName={agent.name}
              page={page === "task" ? "templates" : page}
              onNavigate={(p) => (p === "new" ? onNewTask() : onPageChange(p))}
              onUse={onUseTemplate}
              onConversation={onConversation}
              onStartWork={onStartWork}
              onCompanion={onCompanion}
            />
          )}
        </div>
      </div>
    </div>
  );
}
