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
 * How a reply got its answer, kept quiet: the whole timeline folds into one line that opens to
 * it in order (what Misty said while it worked, each run of tools as a table of its steps), as
 * Claude shows its work. While the run is live the line names what it is doing now; afterwards it
 * says how many steps it took. The answer itself follows below.
 */
export function AgentProgress({ items, live = true }: { items: AiProgressItem[]; live?: boolean }) {
  if (!items.length) return null;
  const groups = groupProgress(items);
  const toolGroups = groups.filter((group) => group.type === "tools");
  const steps = toolGroups.reduce((count, group) => count + stepsOf(group.tools).length, 0);
  // The first thing Misty said is its plan, and stays in view above the folded work.
  const plan = groups[0]?.type === "note" ? groups[0] : undefined;
  const note = (group: { key: string; text: string }) => (
    <div key={group.key} className="agent-progress-note misty-markdown-message">
      <MistyMarkdown>{group.text}</MistyMarkdown>
    </div>
  );
  const timeline = groups
    .filter((group) => group !== plan)
    .map((group) =>
      group.type === "note" ? (
        note(group)
      ) : (
        <ToolGroup key={group.key} tools={group.tools} live={live} />
      ),
    );
  // Narration with no tools is just Misty talking: it stays in the transcript.
  if (!steps) return <div className="agent-progress">{timeline}</div>;
  const latest = toolGroups[toolGroups.length - 1]!;
  return (
    <div className="agent-progress">
      {plan && note(plan)}
      <WorkGroup
        autoOpen={false}
        running={live}
        summary={
          live
            ? toolGroupSummary(latest.tools)
            : `Worked through ${steps} ${steps === 1 ? "step" : "steps"}`
        }
      >
        <div className="agent-progress-timeline">{timeline}</div>
      </WorkGroup>
    </div>
  );
}

function ToolGroup({ tools, live }: { tools: ProgressTool[]; live: boolean }) {
  return (
    <WorkGroup
      summary={toolGroupSummary(tools)}
      running={live && tools.some((tool) => tool.state === "running")}
      // The line above already shimmers for the run: one moving thing at a time.
      shimmer={false}
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
  // One tense, "Used web fetch": a row never flips between "Using" and "Used".
  const { verb } = toolParts(step.name, false);
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
