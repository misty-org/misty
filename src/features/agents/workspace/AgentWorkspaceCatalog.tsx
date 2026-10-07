import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Code,
  FileText,
  Globe,
  Mail,
  Repeat2,
} from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { AgentMethodsCatalog } from "./AgentMethodsCatalog";
import { IntegrationsPage } from "../apps/IntegrationsPage";
import {
  categories,
  examples,
  taskTemplates,
  templatePrompt,
  type Template,
} from "./taskTemplates";

const appIcon = (name: string) =>
  name === "Mail"
    ? Mail
    : name === "Calendar"
      ? CalendarClock
      : name === "Browser"
        ? Globe
        : name === "Code"
          ? Code
          : name === "Files"
            ? FileText
            : BookOpen;
export function AgentWorkspaceCatalog({
  page,
  onNavigate,
  onUse,
  agentId,
  onConversation,
  onStartWork,
  onCompanion,
}: {
  agentName: string;
  agentId: string;
  page: "workflows" | "templates" | "integrations";
  onNavigate(page: "new" | "templates" | "integrations"): void;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
  onCompanion(): void;
}) {
  const [category, setCategory] = useState("All");
  const [detail, setDetail] = useState<Template | null>(null);
  const prompt = templatePrompt;
  return (
    <div className={`agent-studio-pages ${page}`}>
      {/* Keyed so each page starts at the top. */}
      <div key={page} className="agent-studio-page-scroll">
        {page === "integrations" ? (
          <IntegrationsPage
            key={agentId}
            agentId={agentId}
            onCompanion={onCompanion}
            onUse={onUse}
            onConversation={onConversation}
            onStartWork={onStartWork}
          />
        ) : (
          <AgentMethodsCatalog
            key={`${agentId}:${page}`}
            agentId={agentId}
            kind={page === "workflows" ? "workflow" : "template"}
            onUse={onUse}
            onConversation={onConversation}
            onStartWork={onStartWork}
          >
            <section className="agent-method-examples">
              <h2>Start from an example</h2>
              {page === "templates" && (
                <div className="agent-studio-category-strip">
                  {categories.map((name) => (
                    <Button
                      key={name}
                      variant="chip"
                      size="sm"
                      className="font-normal"
                      aria-pressed={name === category}
                      onClick={() => setCategory(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              )}
              <div className="agent-studio-grid">
                {(page === "workflows" ? examples : taskTemplates)
                  .filter(
                    (t) => page === "workflows" || category === "All" || t.category === category,
                  )
                  .map((template) => (
                    <Card className="agent-studio-template-card" key={template.name}>
                      <Button variant="ghost" onClick={() => setDetail(template)}>
                        <span>{template.name}</span>
                        <div className="agent-studio-template-meta">
                          {template.apps.map((name) => {
                            const Icon = appIcon(name);
                            return <Icon key={name} size={16} aria-label={name} />;
                          })}
                          {template.schedule && (
                            <span className="agent-studio-schedule-tag">
                              <Repeat2 size={11} />
                              Suggested cadence
                            </span>
                          )}
                        </div>
                      </Button>
                    </Card>
                  ))}
              </div>
              {page === "workflows" && (
                <Button variant="outline" onClick={() => onNavigate("templates")}>
                  <BookOpen size={15} />
                  Browse all examples
                </Button>
              )}
            </section>
          </AgentMethodsCatalog>
        )}
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="agent-studio-dialog">
          <DialogTitle>{detail?.name}</DialogTitle>
          <DialogDescription>
            Example prompt. Review the draft and the agent’s available connections before starting
            work.
          </DialogDescription>
          <p>{detail ? prompt(detail) : ""}</p>
          <div className="agent-studio-detail-actions">
            <Button
              onClick={() => {
                if (detail) onUse(prompt(detail));
                setDetail(null);
              }}
            >
              Open draft
              <ArrowRight size={14} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
