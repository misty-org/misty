// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import "./runStatus.css";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, ListChecks, Pencil } from "lucide-react";
import { Pressable } from "@/shared/ui";
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
    <span className="run-status-lines">
      <RollingStat prefix="+" value={additions} className="run-status-added" />
      <RollingStat prefix="−" value={deletions} className="run-status-removed" />
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
    <Pressable
      role="tab"
      aria-selected={props.selected}
      className="run-status-pill"
      data-selected={props.selected || undefined}
      onClick={props.onClick}
    >
      {props.running ? <span className="run-status-dot" aria-hidden="true" /> : null}
      {props.icon}
      <span>{props.label}</span>
      {props.count ? <span className="run-status-count">{props.count}</span> : null}
      {props.stats}
    </Pressable>
  );
}

const todoState: Record<ChecklistItem["status"], string> = {
  pending: "Next",
  in_progress: "Running",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
};

function TodoRows({ items, live }: { items: ChecklistItem[]; live: boolean }) {
  return (
    <ul className="run-status-rows">
      {items.map((item) => (
        <li key={item.id} data-state={item.status}>
          <span className="run-status-glyph" data-state={item.status} aria-hidden="true" />
          <span className="run-status-row-title" title={item.title}>
            {item.title}
          </span>
          <span className="run-status-row-state">
            {item.status === "in_progress" && !live ? "Stopped" : todoState[item.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SubagentRows({ subagents }: { subagents: AgentSubagent[] }) {
  return (
    <ul className="run-status-rows">
      {subagents.map((child) => {
        const done = child.state === "completed";
        return (
          <li key={child.invocationId} data-state={done ? "done" : "in_progress"}>
            <span
              className="run-status-glyph"
              data-state={done ? "done" : "in_progress"}
              aria-hidden="true"
            />
            <span className="run-status-row-title" title={child.summary ?? child.goal}>
              {child.goal}
            </span>
            <span className="run-status-row-state">{done ? "Done" : "Running"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FileRows({ files }: { files: EditedFile[] }) {
  return (
    <ul className="run-status-rows">
      {files.map((file) => (
        <li key={file.path} title={file.path}>
          <span className="run-status-row-title">{baseName(file.path)}</span>
          {file.stat ? (
            <LineStats additions={file.stat.additions} deletions={file.stat.deletions} />
          ) : null}
        </li>
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
    <div className="run-status-strip">
      <div className="run-status-panel" data-open={section ? true : undefined}>
        <div>
          <div role="tabpanel" className="run-status-panel-body">
            {section === "todo" && <TodoRows items={todos} live={live} />}
            {section === "subagent" && <SubagentRows subagents={subagents} />}
            {section === "files" && <FileRows files={files} />}
          </div>
        </div>
      </div>
      <div className="run-status-bar">
        {step ? (
          <span className="run-status-step" aria-live="polite">
            <span className="run-status-dot" aria-hidden="true" />
            <span className="agent-progress-shimmer">{step}</span>
          </span>
        ) : null}
        <div className="run-status-pills" role="tablist" aria-label="Run status">
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
              icon={<Bot aria-hidden="true" />}
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
        </div>
      </div>
    </div>
  );
});
