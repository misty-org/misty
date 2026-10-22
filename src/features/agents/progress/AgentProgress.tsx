import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import type { AiProgressItem } from "@/features/ai-surface/types";
import { Pressable } from "@/shared/ui";
import { useId, useState, type ReactNode } from "react";
import { Chevron, Fold, WorkGroup } from "./WorkGroup";
import {
  groupProgress,
  stepMeta,
  stepsOf,
  stepTarget,
  toolGroupSummary,
  toolParts,
  type ProgressStep,
  type ProgressTool,
} from "./progressTimeline";

/**
 * How a reply got its answer, in order: what Misty said while it worked, and
 * each run of tools folded into one line that opens to a table of its steps,
 * as Claude shows its work. The answer itself follows below.
 */
export function AgentProgress({ items, live = true }: { items: AiProgressItem[]; live?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="agent-progress">
      {groupProgress(items).map((group) =>
        group.type === "note" ? (
          <div key={group.key} className="agent-progress-note misty-markdown-message">
            <MistyMarkdown>{group.text}</MistyMarkdown>
          </div>
        ) : (
          <ToolGroup key={group.key} tools={group.tools} live={live} />
        ),
      )}
    </div>
  );
}

function ToolGroup({ tools, live }: { tools: ProgressTool[]; live: boolean }) {
  return (
    <WorkGroup
      summary={toolGroupSummary(tools)}
      running={live && tools.some((tool) => tool.state === "running")}
    >
      <ol className="agent-progress-table" aria-label="Steps">
        {stepsOf(tools).map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </ol>
    </WorkGroup>
  );
}

function Step({ step }: { step: ProgressStep }) {
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const running = step.state === "running";
  const { verb } = toolParts(step.name, running);
  const meta = stepMeta(step);
  const output = stepOutput(step);
  const row = (
    <>
      <span className="agent-progress-verb">{verb}</span>
      <span className="agent-progress-target">{stepTarget(step)}</span>
      {step.state === "failed" ? <span className="sr-only">, failed</span> : null}
      {meta ? <span className="agent-progress-meta">{meta}</span> : null}
      {output ? <Chevron /> : null}
    </>
  );
  return (
    <li className="agent-progress-step" data-state={step.state} data-open={open || undefined}>
      {output ? (
        <Pressable
          className="agent-progress-row"
          aria-expanded={open}
          aria-controls={outputId}
          onClick={() => setOpen(!open)}
        >
          {row}
        </Pressable>
      ) : (
        <div className="agent-progress-row">{row}</div>
      )}
      {output ? (
        <Fold id={outputId} open={open}>
          <div className="agent-progress-output">{output}</div>
        </Fold>
      ) : null}
    </li>
  );
}

/** What a step got back, when it has something to show. */
function stepOutput(step: ProgressStep): ReactNode {
  const { activity, error, state } = step;
  const parts: ReactNode[] = [];
  if (state === "failed")
    parts.push(
      <p key="why" className="agent-progress-why">
        {error || "This step didn't finish."}
      </p>,
    );
  if (activity?.rows?.length)
    parts.push(
      <table key="rows" className="agent-progress-rows">
        <tbody>
          {activity.rows.map((row, index) => (
            <tr key={index}>
              <td>{row.title}</td>
              <td>{row.meta}</td>
            </tr>
          ))}
        </tbody>
      </table>,
    );
  if (activity?.output)
    parts.push(
      <pre key="output" className="agent-progress-pre">
        {activity.output}
      </pre>,
    );
  return parts.length ? parts : null;
}
