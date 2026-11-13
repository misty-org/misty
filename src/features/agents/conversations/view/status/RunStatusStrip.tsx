// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { ListChecks, Network, Pencil } from "lucide-react";
import {
  OverflowFadeText,
  Pressable,
  StepDot,
  Surface,
  Text,
  Tooltip,
  type StepDotState,
} from "@/shared/ui";
import { checklistForInvocation } from "../../../plans/checklists";
import { useCollaborationStore } from "../../../plans/store";
import type { ChecklistItem } from "../../../plans/planTypes";
import type { AgentSubagent } from "../../../runs/invocations/invocationTypes";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { RollingStat } from "./RollingStat";
import { createEditedFilesBuilder, latestReply, liveStep, type EditedFile } from "./runStatus";

type SectionId = "todo" | "subagent" | "files";

const EMPTY: GlobalAiMessage[] = [];

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

function LineStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex gap-1 tabular-nums">
      <Text bare tone="added">
        <RollingStat prefix="+" value={additions} />
      </Text>
      <Text bare tone="removed">
        <RollingStat prefix="−" value={deletions} />
      </Text>
    </span>
  );
}

function Pill(props: {
  selected: boolean;
  running?: boolean;
  label: string;
  count?: string;
  stats?: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    // Muted at rest; the wash brightens it under the pointer, and the open one stays bright.
    <Text bare tone={props.selected ? "default" : "muted"} className="flex">
      <Pressable
        role="tab"
        aria-selected={props.selected}
        wash="control"
        selected={props.selected}
        className={
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 " +
          "transition-colors duration-150 motion-reduce:transition-none"
        }
        onClick={props.onClick}
      >
        {props.running ? <StepDot state="working" size="sm" /> : null}
        {props.icon}
        <span>{props.label}</span>
        {props.count ? (
          <Text bare tone="muted" className="tabular-nums">
            {props.count}
          </Text>
        ) : null}
        {props.stats}
      </Pressable>
    </Text>
  );
}

const todoDot: Record<ChecklistItem["status"], StepDotState> = {
  pending: "pending",
  in_progress: "working",
  done: "done",
  skipped: "pending",
  blocked: "failed",
};

/** A pill's list, in the panel over the strip. */
const rowsClass = "m-0 grid list-none gap-0.5 p-1";
/** A row of a pill's list: its mark, its name fading at the end, and what's after it. */
const rowClass = "flex min-h-8 items-center gap-2 rounded-lg px-2";

const todoState: Record<ChecklistItem["status"], string> = {
  pending: "Next",
  in_progress: "Running",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
};

function TodoRows({ items, live }: { items: ChecklistItem[]; live: boolean }) {
  return (
    <ul className={rowsClass}>
      {items.map((item) => (
        <li key={item.id} data-state={item.status} className={rowClass}>
          <StepDot state={todoDot[item.status]} />
          <Text
            tone={item.status === "done" || item.status === "skipped" ? "muted" : "default"}
            className="flex-1"
            full
          >
            {item.title}
          </Text>
          <Text bare size="caption" tone="muted" className="shrink-0">
            {item.status === "in_progress" && !live ? "Stopped" : todoState[item.status]}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function SubagentRows({ subagents }: { subagents: AgentSubagent[] }) {
  return (
    <ul className={rowsClass}>
      {subagents.map((child) => {
        const done = child.state === "completed";
        return (
          <li
            key={child.invocationId}
            data-state={done ? "done" : "in_progress"}
            className={rowClass}
          >
            <StepDot state={done ? "done" : "working"} />
            <Tooltip content={child.summary ?? ""}>
              <Text tone={done ? "muted" : "default"} className="flex-1" full={!child.summary}>
                {child.goal}
              </Text>
            </Tooltip>
            <Text bare size="caption" tone="muted" className="shrink-0">
              {done ? "Done" : "Running"}
            </Text>
          </li>
        );
      })}
    </ul>
  );
}

function FileRows({ files }: { files: EditedFile[] }) {
  return (
    <ul className={rowsClass}>
      {files.map((file) => (
        <Tooltip key={file.path} content={file.path}>
          <li className={rowClass}>
            <Text tone="default" className="flex-1">
              {baseName(file.path)}
            </Text>
            {file.stat ? (
              <LineStats additions={file.stat.additions} deletions={file.stat.deletions} />
            ) : null}
          </li>
        </Tooltip>
      ))}
    </ul>
  );
}

/**
 * Above the composer: what the latest run is doing now, then pills for its checklist, its
 * sub-agents and the files the chat edited (with +/- counts that roll as they grow). A pill opens
 * its list in a panel that floats above the strip, so the transcript never moves; another pill
 * switches, the same pill or Escape closes. Counts stay after a run ends until a newer one adds to
 * them, and the strip is absent while there's nothing to report.
 */
export const RunStatusStrip = memo(function RunStatusStrip({
  conversationId,
  messages = EMPTY,
}: {
  conversationId?: string;
  messages?: GlobalAiMessage[];
}) {
  const reply = latestReply(messages);
  const live = reply?.state === "pending" || reply?.state === "streaming";
  const step = liveStep(reply);
  const buildFiles = useMemo(createEditedFilesBuilder, [conversationId]);
  const { files, total } = useMemo(() => buildFiles(messages), [buildFiles, messages]);
  const collaboration = useCollaborationStore((state) =>
    conversationId ? state.byConversation[conversationId] : undefined,
  );
  const todos = useMemo(
    () =>
      collaboration && reply?.invocationId
        ? (checklistForInvocation(collaboration.checklists, reply.invocationId).checklist?.items ??
          [])
        : [],
    [collaboration, reply?.invocationId],
  );
  const subagents = reply?.subagents ?? [];
  const [section, setSection] = useState<SectionId | null>(null);
  // A section whose data went away closes, during render so the stale panel never paints.
  const sizes: Record<SectionId, number> = {
    todo: todos.length,
    subagent: subagents.length,
    files: files.length,
  };
  if (section && sizes[section] === 0) setSection(null);
  useEffect(() => {
    if (!section) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section]);
  if (!step && !todos.length && !subagents.length && !files.length) return null;
  const toggle = (id: SectionId) => setSection((current) => (current === id ? null : id));
  const todosDone = todos.filter((item) => item.status === "done" || item.status === "skipped");
  const childrenDone = subagents.filter((child) => child.state === "completed");
  return (
    <div className="relative">
      {/* The panel floats above the strip and folds open with its rows. */}
      <div
        className={
          "pointer-events-none absolute right-0 bottom-full left-0 z-[var(--stack-float)] grid " +
          "grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-out " +
          "data-open:pointer-events-auto data-open:grid-rows-[1fr] data-open:opacity-100 " +
          "motion-reduce:transition-none"
        }
        data-open={section ? true : undefined}
      >
        <div className="min-h-0 overflow-hidden">
          <Surface
            role="tabpanel"
            tone="card"
            edge="hairline"
            radius="xl"
            raised
            className="mb-1.5 max-h-[min(40vh,--spacing(70))] overflow-y-auto"
          >
            <Text bare as="div" size="meta">
              {section === "todo" && <TodoRows items={todos} live={live} />}
              {section === "subagent" && <SubagentRows subagents={subagents} />}
              {section === "files" && <FileRows files={files} />}
            </Text>
          </Surface>
        </div>
      </div>
      {/* The step fades first; the pills keep their width. */}
      <div className="flex min-h-7 items-center gap-2 px-1 pb-2">
        {step ? (
          <Text
            bare
            size="meta"
            className="inline-flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap"
            aria-live="polite"
          >
            <StepDot state="working" size="sm" />
            <OverflowFadeText className="misty-shimmer">{step}</OverflowFadeText>
          </Text>
        ) : null}
        <Text
          bare
          as="div"
          size="caption"
          className="ml-auto flex shrink-0 items-center gap-1.5"
          role="tablist"
          aria-label="Run status"
        >
          {todos.length > 0 && (
            <Pill
              selected={section === "todo"}
              running={live && todos.some((item) => item.status === "in_progress")}
              label="Checklist"
              count={`${todosDone.length}/${todos.length}`}
              icon={<ListChecks aria-hidden="true" />}
              onClick={() => toggle("todo")}
            />
          )}
          {subagents.length > 0 && (
            <Pill
              selected={section === "subagent"}
              running={live && childrenDone.length < subagents.length}
              label="Sub-agents"
              count={`${childrenDone.length}/${subagents.length}`}
              icon={<Network aria-hidden="true" />}
              onClick={() => toggle("subagent")}
            />
          )}
          {files.length > 0 && (
            <Pill
              selected={section === "files"}
              label={files.length === 1 ? "1 file edited" : `${files.length} files edited`}
              icon={<Pencil aria-hidden="true" />}
              stats={
                total ? <LineStats additions={total.additions} deletions={total.deletions} /> : null
              }
              onClick={() => toggle("files")}
            />
          )}
        </Text>
      </div>
    </div>
  );
});
