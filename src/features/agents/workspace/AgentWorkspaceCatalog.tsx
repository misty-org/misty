import { WorkflowsPage } from "./WorkflowsPage";
import { IntegrationsPage } from "../apps/IntegrationsPage";

export function AgentWorkspaceCatalog({
  page,
  onUse,
  agentId,
  onConversation,
  onStartWork,
}: {
  agentName: string;
  agentId: string;
  page: "workflows" | "integrations";
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
}) {
  return (
    <div className={`agent-studio-pages ${page}`}>
      {/* Keyed so each page starts at the top. */}
      <div key={page} className="agent-studio-page-scroll">
        {page === "integrations" ? (
          <IntegrationsPage
            key={agentId}
            agentId={agentId}
            onUse={onUse}
            onConversation={onConversation}
            onStartWork={onStartWork}
          />
        ) : (
          <WorkflowsPage
            key={agentId}
            agentId={agentId}
            onUse={onUse}
            onConversation={onConversation}
            onStartWork={onStartWork}
          />
        )}
      </div>
    </div>
  );
}
