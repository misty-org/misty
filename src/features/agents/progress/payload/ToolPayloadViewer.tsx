// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy, CornerDownRight, FileDiff, Terminal } from "lucide-react";
import {
  CodeDiff,
  CodeText,
  IconButton,
  Pressable,
  Surface,
  Text,
  type CodeDiffLine,
  type CodeDiffLineKind,
} from "@/shared/ui";
import { indentedJson } from "../../runs/markdown/readableJson";
import {
  computeDiffLines,
  isEditToolName,
  parseEditArgs,
  parsePatchLines,
  type DiffLine,
  type EditArgs,
} from "./editLineStats";

interface ToolPayloadViewerProps {
  toolName: string;
  path?: string | null;
  args?: unknown;
  result?: unknown;
}

/** Whether the tool runs a shell command. */
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

function useCopied() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return {
    copied,
    copy: (text: string) => void navigator.clipboard.writeText(text).then(() => setCopied(true)),
  };
}

function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const { copied, copy } = useCopied();
  return (
    <IconButton label={label} className={className} onClick={() => copy(text)}>
      {copied ? <Check /> : <Copy />}
    </IconButton>
  );
}

/** The frame every payload sits in: the page's fill inside a hairline, in full-color text. */
function PayloadFrame({ children }: { children: ReactNode }) {
  return (
    <Surface tone="page" edge="hairline" radius="lg" className="overflow-hidden">
      <Text as="div" bare tone="default">
        {children}
      </Text>
    </Surface>
  );
}

/** A payload's head: its icon, its name in full color, then muted details and a copy button. */
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

/** A file change as a diff, with line numbers on both sides and its +/- counts. */
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
  const rows = useMemo<CodeDiffLine[]>(
    () =>
      diffLines.map((line) => ({
        kind: diffKind[line.type],
        text: line.text,
        oldNumber: line.oldLineNo,
        newNumber: line.newLineNo,
      })),
    [diffLines],
  );
  return (
    <PayloadFrame>
      <PayloadHeader>
        <FileDiff aria-hidden="true" />
        <Text tone="default" full>
          {filePath || "Edited file"}
        </Text>
        <LineCounts additions={addCount} deletions={delCount} />
        <CopyButton text={copyText} label="Copy" className="ml-auto" />
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

/** A diff's added and removed line counts, colored as Git colors them. */
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
    // Codex sends the command as an argument list.
    const command = Array.isArray(raw) ? raw.map(String).join(" ") : (raw as string | undefined);
    const description = typeof record.description === "string" ? record.description : undefined;
    if (command?.trim()) return { command: command.trim(), description };
  }
  return null;
}

/** A tool's result as text, and whether it reads as a failure. */
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

/** A payload's raw text (a result, the parameters): small, muted code that scrolls past 240px. */
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

/** A shell command as a terminal shows it: the prompt line, then what it printed. */
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
        <CopyButton text={command} label="Copy command" className="ml-auto" />
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

/** Any other tool: its raw parameters, then its raw result. */
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
            <CopyButton text={formattedArgs} label="Copy parameters" />
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

/** Whether a tool call carries anything the viewer can show. */
export function hasToolPayload(args: unknown, result: unknown): boolean {
  return args != null || result != null;
}

/** Shows a tool call's raw payload: an edit as a diff, a shell command as a terminal, anything
 * else as its parameters and result. */
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
