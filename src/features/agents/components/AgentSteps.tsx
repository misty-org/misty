import { useId, useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/shared/ui";

export type AgentStep = {
  id: string;
  content: string;
};

/**
 * Interim replies before a turn's final answer ("Got it, starting…", "Submitted, waiting…").
 * Like Claude and ChatGPT, the answer stands alone and the progress is one quiet disclosure.
 */
export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="agent-steps">
      <Button
        variant="ghost"
        size="xs"
        className="agent-steps-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <ListChecks aria-hidden="true" />
        <span>
          {steps.length} progress {steps.length === 1 ? "update" : "updates"}
        </span>
        <ChevronDown aria-hidden="true" className="agent-steps-chevron" />
      </Button>
      {open && (
        <ol id={listId} className="agent-steps-list" aria-label="Progress updates">
          {steps.map((step) => (
            <li key={step.id}>
              {step.content && (
                <div className="agent-step-text">
                  <ReactMarkdown>{step.content}</ReactMarkdown>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
