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
import type { AiProgressItem } from "../runs/invocations/invocation_types";
import {
  CodeText,
  Text,
  ToolBody,
  ToolLines,
  ToolList,
  ToolPath,
  ToolRow,
  TurnFold,
  type TurnPicture,
} from "@misty/ui";
import { Fold } from "./WorkGroup";
import {
  groupProgress,
  settleProgress,
  stepMeta,
  stepsOf,
  stepTarget,
  toolKind,
  toolParts,
  toolLabel,
  type ProgressStep,
  type ProgressTool,
  type ToolKind,
} from "./progress_timeline";
import { usageLimitNotice, usageLimitNotices } from "./usage_limits";
import { countEditLines } from "./payload/edit_line_stats";
import { hasToolPayload, ToolPayloadViewer } from "./payload/ToolPayloadViewer";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";

export const kindIcons: Record<ToolKind, LucideIcon> = {
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

type Entry =
  { type: "note"; key: string; text: string } | { type: "step"; key: string; step: ProgressStep };

export function AgentProgress({ items, live = true }: { items: AiProgressItem[]; live?: boolean }) {
  if (!items.length) return null;
  const steps = live ? items : (settleProgress(items) ?? items);
  const entries: Entry[] = groupProgress(steps).flatMap((group): Entry[] =>
    group.type === "note"
      ? [{ type: "note", key: group.key, text: group.text }]
      : stepsOf(group.tools).map((step, index) => ({
          type: "step",
          key: step.id || `${group.key}:${index}`,
          step,
        })),
  );
  const shown = live
    ? entries.filter((entry) => entry.type === "note" || entry.step.state !== "running")
    : entries;
  const limits = usageLimitNotices(items).map((text) => (
    <Text key={text} as="p" bare size="control" tone="default" className="w-full leading-[1.6]">
      {text}
    </Text>
  ));
  return (
    <div className="mb-3 grid gap-3">
      {runsOf(shown).map((run) =>
        run.type === "note" ? (
          <Text key={run.key} as="div" bare tone="default" className="w-full">
            <MistyMarkdown size="body">{run.text}</MistyMarkdown>
          </Text>
        ) : (
          <Run key={run.key} steps={run.steps} />
        ),
      )}
      {limits}
    </div>
  );
}

type RunPart =
  | { type: "note"; key: string; text: string }
  | { type: "steps"; key: string; steps: Extract<Entry, { type: "step" }>[] };

function runsOf(entries: Entry[]): RunPart[] {
  const runs: RunPart[] = [];
  for (const entry of entries) {
    if (entry.type === "note") {
      runs.push(entry);
      continue;
    }
    const last = runs[runs.length - 1];
    if (last?.type === "steps") last.steps.push(entry);
    else runs.push({ type: "steps", key: entry.key, steps: [entry] });
  }
  return runs;
}

const MOST_PICTURES = 4;

function picturesOf(steps: ProgressTool[]): TurnPicture[] {
  return steps
    .flatMap((step) =>
      (step.pictures ?? []).map((path) => ({
        src: safeTauriAssetUrl(path),
        label: toolLabel(step.name, false, step.args),
      })),
    )
    .slice(-MOST_PICTURES);
}

export function runningOutput(items: AiProgressItem[] | undefined): ReactNode {
  const running = [...(items ?? [])]
    .reverse()
    .find((item) => item.type === "tool" && item.state === "running");
  return running?.type === "tool" ? stepOutput({ ...running, attempts: 1 }) : null;
}

function Run({ steps }: { steps: Extract<Entry, { type: "step" }>[] }) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  const pictures = picturesOf(steps.map((entry) => entry.step));
  return (
    <div className="grid">
      <TurnFold
        summary={steps.length === 1 ? "1 step" : `${steps.length} steps`}
        open={open}
        onToggle={() => setOpen(!open)}
        controls={stepsId}
        pictures={pictures.length ? pictures : undefined}
      />
      <Fold id={stepsId} open={open} onReveal={() => setOpen(true)}>
        <ToolList label="Steps">
          {exploreGroups(steps).map((item) =>
            item.type === "explore" ? (
              <Explore key={item.key} steps={item.steps} />
            ) : (
              <Step key={item.key} step={item.step} />
            ),
          )}
        </ToolList>
      </Fold>
    </div>
  );
}

type StepEntry = Extract<Entry, { type: "step" }>;
type RunItem = StepEntry | { type: "explore"; key: string; steps: ProgressStep[] };

function exploreGroups(steps: StepEntry[]): RunItem[] {
  const items: RunItem[] = [];
  let group: StepEntry[] = [];
  const flush = () => {
    if (group.length > 1)
      items.push({ type: "explore", key: group[0].key, steps: group.map((entry) => entry.step) });
    else items.push(...group);
    group = [];
  };
  for (const entry of steps) {
    if (exploring(entry.step)) group.push(entry);
    else {
      flush();
      items.push(entry);
    }
  }
  flush();
  return items;
}

function exploreSummary(steps: ProgressStep[]) {
  const reads = steps.filter((step) => toolKind(step.name) === "read").length;
  const searches = steps.length - reads;
  return [
    reads ? (reads === 1 ? "1 file" : `${reads} files`) : "",
    searches ? (searches === 1 ? "1 search" : `${searches} searches`) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function Explore({ steps }: { steps: ProgressStep[] }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <li>
      <ToolRow
        name="Explored"
        target={exploreSummary(steps)}
        open={open}
        onToggle={() => setOpen(!open)}
        controls={bodyId}
      />
      <Fold id={bodyId} open={open} onReveal={() => setOpen(true)}>
        <ToolBody>
          {steps.map((step, index) => (
            <Text key={step.id || index} size="meta" tone="muted">
              {toolParts(step.name, false, step.args).verb}{" "}
              <Text as="span" bare size="meta" tone="default">
                {stepTarget(step)}
              </Text>
            </Text>
          ))}
        </ToolBody>
      </Fold>
    </li>
  );
}

const exploring = (step: ProgressStep) => {
  const kind = toolKind(step.name);
  return (kind === "read" || kind === "search") && step.state !== "failed";
};

function failureLine(step: ProgressStep): string {
  const notice = usageLimitNotice(step.error);
  if (notice) return notice;
  const text = step.error || step.activity?.output || "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "This step didn't finish.";
}

const looksLikePath = (text: string) =>
  /[\\/]/.test(text) && !/\s/.test(text) && !/^https?:/.test(text);

function Step({ step }: { step: ProgressStep }) {
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const running = step.state === "running";
  const { verb } = toolParts(step.name, running, step.args);
  const target = stepTarget(step);
  const failed = step.state === "failed";
  const output = exploring(step) ? null : stepOutput(step);
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
        name={verb}
        target={target ? looksLikePath(target) ? <ToolPath path={target} /> : target : undefined}
        meta={meta}
        state={running ? "running" : failed ? "failed" : "done"}
        open={output ? open : undefined}
        onToggle={output ? () => setOpen(!open) : undefined}
        controls={output ? outputId : undefined}
      />
      {failed && !open ? (
        <ToolBody>
          <Text size="meta" tone="muted">
            {failureLine(step)}
          </Text>
        </ToolBody>
      ) : null}
      {output ? (
        <Fold id={outputId} open={open} onReveal={() => setOpen(true)}>
          <ToolBody>{output}</ToolBody>
        </Fold>
      ) : null}
    </li>
  );
}

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
