import { useId, useState } from "react";
import { ChevronDown, CircleAlert, MessageSquareText, Wrench } from "lucide-react";
import type { MistyActivityEntry } from "@/features/misty/activity";
import { Button } from "@/shared/ui";

type ActivityEvent = MistyActivityEntry["events"][number];
type Step = { tool?: string; label: string; detail?: string; error?: string };

/** "browser_navigate" or "browserNavigate" → "Browser navigate". */
function humanize(value: string) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.:/-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One row per tool call: a call's start, progress and end events merge into one step. */
export function toolSteps(events: ActivityEvent[]): Step[] {
  const steps: Step[] = [];
  for (const event of events) {
    const tool = event.toolName || event.tool_name || undefined;
    const detail = event.text?.trim() || undefined;
    const error = event.error?.trim() || undefined;
    const previous = steps[steps.length - 1];
    if (tool && previous?.tool === tool && !previous.error) {
      previous.detail = detail ?? previous.detail;
      previous.error = error;
      continue;
    }
    const label = tool
      ? humanize(tool)
      : error
        ? "Error"
        : detail
          ? ""
          : humanize(event.phase || event.type || "Step");
    if (!label && !detail && !error) continue;
    steps.push({ tool, label, detail, error });
  }
  return steps;
}

export function ToolActivity({ events }: { events: ActivityEvent[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const steps = toolSteps(events);
  if (!steps.length) return null;
  const failed = steps.filter((step) => step.error).length;
  return (
    <div className="agent-tool-activity">
      <Button
        variant="ghost"
        size="xs"
        className="agent-tool-activity-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <Wrench aria-hidden="true" />
        <span>
          {steps.length} {steps.length === 1 ? "step" : "steps"}
          {failed > 0 && ` · ${failed} failed`}
        </span>
        <ChevronDown aria-hidden="true" className="agent-tool-activity-chevron" />
      </Button>
      {open && (
        <ol id={listId} className="agent-tool-activity-steps" aria-label="Tool activity">
          {steps.map((step, index) => {
            const Icon = step.error ? CircleAlert : step.tool ? Wrench : MessageSquareText;
            return (
              <li key={index}>
                <Icon aria-hidden="true" />
                <div>
                  {step.label && <strong>{step.label}</strong>}
                  {(step.error || step.detail) && <p>{step.error || step.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
