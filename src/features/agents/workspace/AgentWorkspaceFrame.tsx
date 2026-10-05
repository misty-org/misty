import type { ReactNode } from "react";
import { Activity, LayoutGrid, Maximize2, Plug, SquarePen, Workflow, X } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import { Button, IconButton } from "@/shared/ui";
import { AgentRecentConversations } from "./AgentRecentConversations";
import { AgentAvatar } from "../components/AgentAvatar";
import { AgentActivityPage } from "./AgentActivityPage";
import { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog";
import "./agentWorkspaceCatalog.css";
import "./agentWorkspaceFrame.css";

export type AgentWorkspacePage = "task" | "activity" | "workflows" | "templates" | "integrations";
type RecentConversation = { id: string; title?: string; updatedAt: string };

/** Presentation only. Existing conversation and account actions remain owned by AgentsPage. */
export function AgentWorkspaceFrame({
  agent,
  page,
  conversations,
  conversationId,
  disabled,
  floating,
  identity,
  children,
  activitySection,
  onPageChange,
  onNewTask,
  onConversation,
  onUseTemplate,
  onStartWork,
  onFloatingChange,
  onCompanion,
}: {
  agent: AgentProfile;
  page: AgentWorkspacePage;
  conversations: RecentConversation[];
  conversationId: string;
  disabled: boolean;
  floating: boolean;
  /** The agent switcher. It also holds New agent and this agent's settings. */
  identity: ReactNode;
  children: ReactNode;
  activitySection?: "activity" | "scheduled";
  onPageChange(page: AgentWorkspacePage): void;
  onNewTask(): void;
  onConversation(id: string): void;
  onUseTemplate(prompt: string): void;
  onStartWork(action: () => void): void;
  onFloatingChange(floating: boolean): void;
  onCompanion(): void;
}) {
  const recent = [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12);
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
          recent={recent}
          activeId={page === "task" ? conversationId : undefined}
          disabled={disabled}
          onConversation={onConversation}
        />
      </aside>
      <div className="agent-studio-canvas">
        {/* Keep the live conversation mounted while browsing catalogs; its draft and voice state belong to it. */}
        <div
          className="agent-studio-task"
          hidden={page !== "task" && !floating}
          data-floating={floating}
        >
          {floating && (
            <div className="agent-studio-floating-bar">
              <AgentAvatar agent={agent} />
              <strong>{agent.name}</strong>
              <span />
              <IconButton
                label="Return to full conversation"
                onClick={() => {
                  onPageChange("task");
                  onFloatingChange(false);
                }}
              >
                <Maximize2 size={15} />
              </IconButton>
              <IconButton
                label="Close floating conversation"
                onClick={() => onFloatingChange(false)}
              >
                <X size={16} />
              </IconButton>
            </div>
          )}
          {children}
        </div>
        <div className="agent-studio-catalog-host" hidden={page === "task"}>
          {page === "activity" ? (
            <AgentActivityPage initialSection={activitySection} />
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
        {page === "task" && floating && (
          <div className="agent-studio-floating-placeholder">
            <AgentAvatar agent={agent} />
            <h1>Your conversation is floating</h1>
            <p>Browse activity, workflows and templates while keeping the conversation open.</p>
            <Button variant="outline" onClick={() => onFloatingChange(false)}>
              Return to conversation
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
