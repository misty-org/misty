// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import "./toolPayload.css";
import { memo, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Copy, CornerDownRight, FileDiff, Terminal } from "lucide-react";
import { IconButton, Pressable } from "@/shared/ui";
import { indentedJson } from "../../runs/markdown/readableJson";
import {
  computeDiffLines,
  isEditToolName,
  parseEditArgs,
  parsePatchLines,
  type DiffLine,
  type EditArgs,
} from "./editLineStats";

export interface ToolPayloadViewerProps {
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

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopied();
  return (
    <IconButton size="sm" label={copied ? "Copied" : label} onClick={() => copy(text)}>
      {copied ? <Check /> : <Copy />}
    </IconButton>
  );
}

/** A file change as a diff, with line numbers on both sides and its +/- counts. */
export const FileDiffViewer = memo(function FileDiffViewer({
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
  return (
    <div className="tool-payload">
      <div className="tool-payload-header">
        <FileDiff aria-hidden="true" />
        <span className="tool-payload-title" title={filePath}>
          {filePath || "Edited file"}
        </span>
        <LineCounts additions={addCount} deletions={delCount} />
        <CopyButton text={copyText} label="Copy" />
      </div>
      <div className="tool-payload-body" role="table" aria-label="Changes">
        {diffLines.length === 0 ? (
          <p className="tool-payload-empty">No changes</p>
        ) : (
          diffLines.map((line, index) => (
            <div key={index} className="tool-payload-diff-line" data-kind={line.type} role="row">
              <span className="tool-payload-line-number">{line.oldLineNo ?? ""}</span>
              <span className="tool-payload-line-number">{line.newLineNo ?? ""}</span>
              <span className="tool-payload-sign" aria-hidden="true">
                {line.type === "add"
                  ? "+"
                  : line.type === "del"
                    ? "-"
                    : line.type === "header"
                      ? "@"
                      : " "}
              </span>
              <span className="tool-payload-line-text">{line.text || " "}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

/** A diff's added and removed line counts, colored as Git colors them. */
export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="tool-payload-counts">
      {additions > 0 && <span data-kind="add">+{additions}</span>}
      {deletions > 0 && <span data-kind="del">-{deletions}</span>}
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
export function formatExecutionResult(result: unknown): { text: string; isError: boolean } | null {
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
    <Pressable className="tool-payload-result-toggle" aria-expanded={open} onClick={onToggle}>
      <CornerDownRight aria-hidden="true" />
      <span>Result</span>
      {failed && (
        <span className="tool-payload-failed">
          <CircleAlert aria-hidden="true" />
          Failed
        </span>
      )}
    </Pressable>
  );
}

/** A shell command as a terminal shows it: the prompt line, then what it printed. */
export const BashCommandViewer = memo(function BashCommandViewer({
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
    <div className="tool-payload">
      <div className="tool-payload-header">
        <Terminal aria-hidden="true" />
        <span className="tool-payload-title">{toolName}</span>
        {description && (
          <span className="tool-payload-description" title={description}>
            {description}
          </span>
        )}
        <CopyButton text={command} label="Copy command" />
      </div>
      <div className="tool-payload-command">
        <span className="tool-payload-prompt" aria-hidden="true">
          $
        </span>
        <pre>{command}</pre>
      </div>
      {formatted && (
        <div className="tool-payload-result">
          <ResultToggle
            open={showResult}
            onToggle={() => setShowResult(!showResult)}
            failed={formatted.isError}
          />
          {showResult && (
            <pre className="tool-payload-output" data-failed={formatted.isError || undefined}>
              {formatted.text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

/** Any other tool: its raw parameters, then its raw result. */
export const GenericToolViewer = memo(function GenericToolViewer({
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
    <div className="tool-payload">
      {formattedArgs && (
        <div className="tool-payload-section">
          <div className="tool-payload-label">
            <span>Parameters</span>
            <CopyButton text={formattedArgs} label="Copy parameters" />
          </div>
          <pre className="tool-payload-output">{formattedArgs}</pre>
        </div>
      )}
      {formatted && (
        <div className="tool-payload-result">
          <ResultToggle
            open={showResult}
            onToggle={() => setShowResult(!showResult)}
            failed={formatted.isError}
          />
          {showResult && (
            <pre className="tool-payload-output" data-failed={formatted.isError || undefined}>
              {formatted.text}
            </pre>
          )}
        </div>
      )}
    </div>
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
