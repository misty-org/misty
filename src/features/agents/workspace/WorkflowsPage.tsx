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
import {
  categories,
  examples,
  taskTemplates,
  templatePrompt,
  type Template,
} from "./taskTemplates";

/** Starter workflows: the scheduled examples first, then the one-off prompts, each once. */
const starters = [...examples, ...taskTemplates].filter(
  (item, index, all) => all.findIndex((other) => other.name === item.name) === index,
);

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

/**
 * The agent's workflows: saved ones to run or schedule, then a gallery of starter workflows.
 * Saved templates from before are listed with the workflows; a template is just a workflow.
 */
export function WorkflowsPage({
  agentId,
  onUse,
  onConversation,
  onStartWork,
}: {
  agentId: string;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
}) {
  const [category, setCategory] = useState("All");
  const [detail, setDetail] = useState<Template | null>(null);
  return (
    <AgentMethodsCatalog
      agentId={agentId}
      kind="workflow"
      onUse={onUse}
      onConversation={onConversation}
      onStartWork={onStartWork}
    >
      <section className="agent-method-examples">
        <h2>Start from an example</h2>
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
        <div className="agent-studio-grid">
          {starters
            .filter((item) => category === "All" || item.category === category)
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
      </section>
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
          <p>{detail ? templatePrompt(detail) : ""}</p>
          <div className="agent-studio-detail-actions">
            <Button
              onClick={() => {
                if (detail) onUse(templatePrompt(detail));
                setDetail(null);
              }}
            >
              Open draft
              <ArrowRight size={14} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AgentMethodsCatalog>
  );
}
