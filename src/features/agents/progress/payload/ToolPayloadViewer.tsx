// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { memo, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, CornerDownRight, FileDiff, Terminal } from "lucide-react";
import {
  CodeDiff,
  CodeText,
  CopyButton,
  Pressable,
  Surface,
  Text,
  type CodeDiffLine,
  type CodeDiffLineKind,
} from "@misty/ui";
import { indentedJson } from "../../runs/markdown/readable_json";
import {
  computeDiffLines,
  isEditToolName,
  parseEditArgs,
  parsePatchLines,
  type DiffLine,
  type EditArgs,
} from "./edit_line_stats";

interface ToolPayloadViewerProps {
  toolName: string;
  path?: string | null;
  args?: unknown;
  result?: unknown;
}

function isBashTool(name: string): boolean {
  const lower =
    name
      .toLowerCase()
      .split(/__|[./:]/)
      .pop() ?? "";
  return (
    lower === "bash" ||
    lower === "sh" ||
    lower === "shell" ||
    lower === "terminal" ||
    lower.includes("command") ||
    lower.includes("exec")
  );
}

function PayloadFrame({ children }: { children: ReactNode }) {
  return (
    <Surface tone="page" edge="hairline" radius="lg" className="overflow-hidden">
      <Text as="div" bare tone="default">
        {children}
      </Text>
    </Surface>
  );
}

function PayloadHeader({ children }: { children: ReactNode }) {
  return (
    <Text
      as="div"
      bare
      size="caption"
      tone="muted"
      className="flex min-w-0 items-center gap-1.5 border-b py-1 pr-1.5 pl-2.5"
    >
      {children}
    </Text>
  );
}

const diffKind: Record<DiffLine["type"], CodeDiffLineKind> = {
  add: "add",
  del: "del",
  ctx: "context",
  header: "header",
};

const FileDiffViewer = memo(function FileDiffViewer({
  filePath,
  oldString,
  newString,
  content,
  patch,
}: EditArgs) {
  const diffLines = useMemo<DiffLine[]>(() => {
    if (patch) return parsePatchLines(patch);
    if (content !== undefined)
      return content.split("\n").map((text, index) => ({
        type: "add" as const,
        text,
        newLineNo: index + 1,
      }));
    return computeDiffLines(oldString, newString);
  }, [patch, content, oldString, newString]);
  const { addCount, delCount } = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const line of diffLines) {
      if (line.type === "add") add++;
      else if (line.type === "del") del++;
    }
    return { addCount: add, delCount: del };
  }, [diffLines]);
  const copyText = newString ?? content ?? patch ?? oldString ?? "";
  const rows = useMemo<CodeDiffLine[]>(() => foldUnchanged(diffLines), [diffLines]);
  return (
    <PayloadFrame>
      <PayloadHeader>
        <FileDiff aria-hidden="true" />
        <Text tone="default" full>
          {filePath || "Edited file"}
        </Text>
        <LineCounts additions={addCount} deletions={delCount} />
        <CopyButton value={copyText} className="ml-auto" />
      </PayloadHeader>
      <div className="max-h-72 overflow-auto py-1">
        {rows.length === 0 ? (
          <Text wrap size="caption" tone="muted" className="px-3 py-1.5">
            No changes
          </Text>
        ) : (
          <CodeDiff label="Changes" lines={rows} />
        )}
      </div>
    </PayloadFrame>
  );
});

const KEEP_AROUND = 3;
const FOLD_FROM = 8;

function foldUnchanged(lines: DiffLine[]): CodeDiffLine[] {
  const rows: CodeDiffLine[] = [];
  let run: DiffLine[] = [];
  const flush = (atEnd: boolean) => {
    const start = rows.length === 0;
    if (run.length < FOLD_FROM) rows.push(...run.map(toRow));
    else {
      const head = start ? 0 : KEEP_AROUND;
      const tail = atEnd ? 0 : KEEP_AROUND;
      const hidden = run.length - head - tail;
      rows.push(...run.slice(0, head).map(toRow));
      rows.push({
        kind: "header",
        text: hidden === 1 ? "1 unchanged line" : `${hidden} unchanged lines`,
      });
      rows.push(...run.slice(run.length - tail).map(toRow));
    }
    run = [];
  };
  for (const line of lines) {
    if (line.type === "ctx") run.push(line);
    else {
      if (run.length) flush(false);
      rows.push(toRow(line));
    }
  }
  if (run.length) flush(true);
  return rows;
}

function toRow(line: DiffLine): CodeDiffLine {
  return {
    kind: diffKind[line.type],
    text: line.text,
    oldNumber: line.oldLineNo,
    newNumber: line.newLineNo,
  };
}

export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="inline-flex gap-1 tabular-nums">
      {additions > 0 && (
        <Text bare tone="added">
          +{additions}
        </Text>
      )}
      {deletions > 0 && (
        <Text bare tone="removed">
          -{deletions}
        </Text>
      )}
    </span>
  );
}

interface BashArgs {
  command: string;
  description?: string;
}

function parseBashArgs(args: unknown): BashArgs | null {
  if (!args) return null;
  if (typeof args === "string") {
    const command = args.trim();
    return command ? { command } : null;
  }
  if (typeof args === "object") {
    const record = args as Record<string, unknown>;
    const raw = [record.command, record.cmd, record.script].find(
      (value) => typeof value === "string" || Array.isArray(value),
    );
    const command = Array.isArray(raw) ? raw.map(String).join(" ") : (raw as string | undefined);
    const description = typeof record.description === "string" ? record.description : undefined;
    if (command?.trim()) return { command: command.trim(), description };
  }
  return null;
}

function formatExecutionResult(result: unknown): { text: string; isError: boolean } | null {
  if (result == null) return null;
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed ? { text: indentedJson(trimmed) ?? trimmed, isError: false } : null;
  }
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    const isError = Boolean(record.is_error || record.isError || (stderr && !stdout));
    if (stdout && stderr) return { text: `${stdout}\n--- stderr ---\n${stderr}`, isError };
    if (stderr) return { text: stderr, isError: true };
    if (stdout) return { text: stdout, isError: false };
    try {
      const text = JSON.stringify(result, null, 2);
      return text && text !== "{}" ? { text, isError } : null;
    } catch {
      return { text: String(result), isError: false };
    }
  }
  return { text: String(result), isError: false };
}

function PayloadOutput({ failed = false, children }: { failed?: boolean; children: ReactNode }) {
  return (
    <CodeText
      size="micro"
      tone={failed ? "failed" : "muted"}
      data-failed={failed || undefined}
      className="max-h-60 overflow-auto px-3 pt-1 pb-2 leading-normal"
    >
      {children}
    </CodeText>
  );
}

function ResultToggle({
  open,
  onToggle,
  failed,
}: {
  open: boolean;
  onToggle: () => void;
  failed: boolean;
}) {
  return (
    <Pressable
      wash="text"
      className="flex items-center gap-1 px-2.5 py-1 text-micro"
      aria-expanded={open}
      onClick={onToggle}
    >
      <CornerDownRight aria-hidden="true" />
      <span>Result</span>
      {failed && (
        <Text bare tone="failed" className="inline-flex items-center gap-0.5">
          <CircleAlert aria-hidden="true" />
          Failed
        </Text>
      )}
    </Pressable>
  );
}

const BashCommandViewer = memo(function BashCommandViewer({
  toolName,
  command,
  description,
  result,
}: {
  toolName: string;
  command: string;
  description?: string;
  result?: unknown;
}) {
  const [showResult, setShowResult] = useState(true);
  const formatted = useMemo(() => formatExecutionResult(result), [result]);
  return (
    <PayloadFrame>
      <PayloadHeader>
        <Terminal aria-hidden="true" />
        <Text tone="default" full>
          {toolName}
        </Text>
        {description && (
          <Text full className="flex-1">
            {description}
          </Text>
        )}
        <CopyButton value={command} label="Copy command" className="ml-auto" />
      </PayloadHeader>
      <div className="flex items-start gap-2 px-3 py-2">
        <CodeText tone="muted" aria-hidden="true" className="leading-[1.55] select-none">
          $
        </CodeText>
        <CodeText className="flex-1 leading-[1.55]">{command}</CodeText>
      </div>
      {formatted && (
        <Text as="div" bare tone="muted" className="border-t">
          <ResultToggle
            open={showResult}
            onToggle={() => setShowResult(!showResult)}
            failed={formatted.isError}
          />
          {showResult && <PayloadOutput failed={formatted.isError}>{formatted.text}</PayloadOutput>}
        </Text>
      )}
    </PayloadFrame>
  );
});

const GenericToolViewer = memo(function GenericToolViewer({
  args,
  result,
}: {
  args?: unknown;
  result?: unknown;
}) {
  const [showResult, setShowResult] = useState(true);
  const formattedArgs = useMemo(() => {
    if (args == null) return null;
    if (typeof args === "string") return indentedJson(args) ?? (args.trim() || null);
    try {
      const text = JSON.stringify(args, null, 2);
      return text && text !== "{}" && text !== "[]" ? text : null;
    } catch {
      return String(args);
    }
  }, [args]);
  const formatted = useMemo(() => formatExecutionResult(result), [result]);
  if (!formattedArgs && !formatted) return null;
  return (
    <PayloadFrame>
      {formattedArgs && (
        <div>
          <Text
            as="div"
            bare
            tone="muted"
            className="flex items-center justify-between pt-0.5 pr-1.5 pl-2.5 text-micro"
          >
            <span>Parameters</span>
            <CopyButton value={formattedArgs} label="Copy parameters" />
          </Text>
          <PayloadOutput>{formattedArgs}</PayloadOutput>
        </div>
      )}
      {formatted && (
        <Text as="div" bare tone="muted" className="border-t">
          <ResultToggle
            open={showResult}
            onToggle={() => setShowResult(!showResult)}
            failed={formatted.isError}
          />
          {showResult && <PayloadOutput failed={formatted.isError}>{formatted.text}</PayloadOutput>}
        </Text>
      )}
    </PayloadFrame>
  );
});

export function hasToolPayload(args: unknown, result: unknown): boolean {
  return args != null || result != null;
}

export const ToolPayloadViewer = memo(function ToolPayloadViewer({
  toolName,
  path,
  args,
  result,
}: ToolPayloadViewerProps) {
  if (isEditToolName(toolName) || /edit|write|patch|diff/i.test(toolName)) {
    const editArgs = parseEditArgs(args);
    if (editArgs)
      return (
        <FileDiffViewer
          filePath={editArgs.filePath ?? path ?? undefined}
          oldString={editArgs.oldString}
          newString={editArgs.newString}
          content={editArgs.content}
          patch={editArgs.patch}
        />
      );
  }
  if (isBashTool(toolName)) {
    const bashArgs = parseBashArgs(args);
    if (bashArgs)
      return (
        <BashCommandViewer
          toolName={toolName}
          command={bashArgs.command}
          description={bashArgs.description}
          result={result}
        />
      );
  }
  return <GenericToolViewer args={args} result={result} />;
});
