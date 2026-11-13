// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import {
  Bot,
  FileText,
  Flag,
  Globe,
  ListChecks,
  MousePointerClick,
  PencilLine,
  Search,
  Send,
  SquareTerminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { MistyMarkdown } from "../runs/markdown/MistyMarkdown";
import type { AiProgressItem } from "../runs/invocations/invocationTypes";
import {
  CodeText,
  Text,
  ToolBody,
  ToolLines,
  ToolList,
  ToolNote,
  ToolPath,
  ToolRow,
  TurnFold,
} from "@/shared/ui";
import { Fold } from "./WorkGroup";
import {
  groupProgress,
  stepMeta,
  stepsOf,
  stepTarget,
  toolKind,
  toolParts,
  turnSummary,
  type ProgressStep,
  type ProgressTool,
  type ToolKind,
} from "./progressTimeline";
import { usageLimitNotice, usageLimitNotices } from "./usageLimits";
import { countEditLines } from "./payload/editLineStats";
import { hasToolPayload, ToolPayloadViewer } from "./payload/ToolPayloadViewer";

/** Each kind of step's icon: what the step is, never a generic sparkle. */
const kindIcons: Record<ToolKind, LucideIcon> = {
  command: SquareTerminal,
  read: FileText,
  search: Search,
  edit: PencilLine,
  web: Globe,
  browser: MousePointerClick,
  tasks: ListChecks,
  agent: Bot,
  delete: Trash2,
  send: Send,
  finish: Flag,
  other: Wrench,
};

/** A live turn keeps this many of its latest steps in view; the rest wait behind "+N more". */
const LIVE_ROWS = 6;

type Entry =
  { type: "note"; key: string; text: string } | { type: "step"; key: string; step: ProgressStep };

/**
 * How a reply got its answer, after OpenChamber's turn: the first thing Misty said (its plan)
 * stays in view, then the turn's one line. While the run is live the line names what it is doing
 * now and opens on the latest steps; once it ends it folds to what it did ("Read 3 files · ran 2
 * commands"). Opened, it lists every step in order as one quiet row each, with what Misty wrote
 * between them; a step with output opens under its row. The answer itself follows below.
 */
export function AgentProgress({ items, live = true }: { items: AiProgressItem[]; live?: boolean }) {
  if (!items.length) return null;
  const groups = groupProgress(items);
  const toolGroups = groups.filter((group) => group.type === "tools");
  // The first thing Misty said is its plan, and stays in view above the folded work.
  const plan = groups[0]?.type === "note" ? groups[0] : undefined;
  const note = (group: { key: string; text: string }) => (
    <Text
      key={group.key}
      as="div"
      bare
      size="control"
      tone="default"
      className="w-full leading-[1.6] misty-markdown-message"
    >
      <MistyMarkdown>{group.text}</MistyMarkdown>
    </Text>
  );
  // A used-up monthly allowance stays in view below the folded work, said plainly.
  const limits = usageLimitNotices(items).map((text) => (
    <Text key={text} as="p" bare size="control" tone="default" className="w-full leading-[1.6]">
      {text}
    </Text>
  ));
  // Narration with no tools is just Misty talking: it stays in the transcript.
  if (!toolGroups.length)
    return (
      <div className="mb-3 grid gap-1">
        {groups.map((group) => (group.type === "note" ? note(group) : null))}
        {limits}
      </div>
    );
  const entries: Entry[] = groups
    .filter((group) => group !== plan)
    .flatMap((group): Entry[] =>
      group.type === "note"
        ? [{ type: "note", key: group.key, text: group.text }]
        : stepsOf(group.tools).map((step, index) => ({
            type: "step",
            key: step.id || `${group.key}:${index}`,
            step,
          })),
    );
  const tools = toolGroups.flatMap((group) => (group.type === "tools" ? group.tools : []));
  return (
    <div className="mb-3 grid gap-1">
      {plan && note(plan)}
      <Turn entries={entries} tools={tools} live={live} />
      {limits}
    </div>
  );
}

function Turn({
  entries,
  tools,
  live,
}: {
  entries: Entry[];
  tools: ProgressTool[];
  live: boolean;
}) {
  const [chosen, setChosen] = useState<boolean>();
  const [all, setAll] = useState(false);
  const listId = useId();
  // Open while the run works, unless the person folded it; folded once it ends.
  const open = chosen ?? live;
  const hidden = live && !all ? Math.max(0, entries.length - LIVE_ROWS) : 0;
  const shown = hidden ? entries.slice(-LIVE_ROWS) : entries;
  const running = [...tools].reverse().find((tool) => tool.state === "running");
  const summary = live
    ? running
      ? `${toolParts(running.name, true).verb} ${stepTarget(running)}`.trim()
      : "Working"
    : turnSummary(tools);
  return (
    <div className="agent-turn">
      <TurnFold
        summary={summary}
        live={live}
        open={open}
        more={open ? hidden : undefined}
        controls={listId}
        onToggle={() => {
          // Open with earlier steps hidden, the line shows them all before it folds.
          if (open && hidden) setAll(true);
          else setChosen(!open);
        }}
      />
      <Fold
        id={listId}
        open={open}
        onReveal={() => {
          setChosen(true);
          setAll(true);
        }}
      >
        <ToolList label="Steps">
          {shown.map((entry) =>
            entry.type === "note" ? (
              <li key={entry.key}>
                <ToolNote>
                  <MistyMarkdown>{entry.text}</MistyMarkdown>
                </ToolNote>
              </li>
            ) : (
              <Step key={entry.key} step={entry.step} />
            ),
          )}
        </ToolList>
      </Fold>
    </div>
  );
}

/** A target that reads as a file path, so its folder can step back. */
const looksLikePath = (text: string) =>
  /[\\/]/.test(text) && !/\s/.test(text) && !/^https?:/.test(text);

function Step({ step }: { step: ProgressStep }) {
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const running = step.state === "running";
  const { verb } = toolParts(step.name, running);
  const target = stepTarget(step);
  const output = stepOutput(step);
  // An edit's +/- counts, from its own arguments.
  const lines = step.args === undefined ? null : countEditLines(step.args);
  const end =
    step.state === "failed"
      ? step.attempts > 1
        ? `Failed ${step.attempts}×`
        : "Failed"
      : stepMeta(step);
  const meta =
    lines || end ? (
      <>
        {lines ? <ToolLines added={lines.additions} removed={lines.deletions} /> : null}
        {end ? <span>{end}</span> : null}
      </>
    ) : undefined;
  return (
    <li>
      <ToolRow
        icon={kindIcons[toolKind(step.name)]}
        name={verb}
        target={target ? looksLikePath(target) ? <ToolPath path={target} /> : target : undefined}
        meta={meta}
        state={running ? "running" : step.state === "failed" ? "failed" : "done"}
        open={output ? open : undefined}
        onToggle={output ? () => setOpen(!open) : undefined}
        controls={output ? outputId : undefined}
      />
      {output ? (
        <Fold id={outputId} open={open} onReveal={() => setOpen(true)}>
          <ToolBody onFold={() => setOpen(false)}>{output}</ToolBody>
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
      <Text key="why" wrap tone="muted">
        {usageLimitNotice(error) ?? (error || "This step didn't finish.")}
      </Text>,
    );
  if (activity?.rows?.length)
    parts.push(
      <table key="rows" className="w-full border-collapse">
        <tbody className="[&>tr+tr>td]:border-t">
          {activity.rows.map((row, index) => (
            <tr key={index}>
              <Text as="td" bare tone="default" className="py-1 pr-3 align-top">
                {row.title}
              </Text>
              <Text
                as="td"
                bare
                tone="muted"
                className="py-1 text-right align-top whitespace-nowrap"
              >
                {row.meta}
              </Text>
            </tr>
          ))}
        </tbody>
      </table>,
    );
  // The raw payload, when the run sent it, says more than the summarized output.
  if (hasToolPayload(step.args, step.result))
    parts.push(
      <ToolPayloadViewer
        key="payload"
        toolName={step.name}
        path={step.path}
        args={step.args}
        result={step.result}
      />,
    );
  else if (activity?.output)
    parts.push(
      <CodeText key="output" tone="muted" className="max-h-[46vh] overflow-auto leading-[1.6]">
        {activity.output}
      </CodeText>,
    );
  return parts.length ? parts : null;
}
