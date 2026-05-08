import { AlertCircle, AlertTriangle, GitBranch, Settings2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useGitStore } from "../git/useGitStore";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useGroupCursor, useGroupDiagnostics } from "../store/useEditorEphemeralStore";

const LANGUAGE_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  htm: "HTML",
  md: "Markdown",
  mdx: "Markdown",
  rs: "Rust",
  py: "Python",
  toml: "TOML",
  yml: "YAML",
  yaml: "YAML",
  sh: "Shell",
  txt: "Plain Text",
};

function labelFor(name: string | undefined): string {
  if (!name) return "";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_LABELS[extension] ?? (extension ? extension.toUpperCase() : "Plain Text");
}

interface CodeStatusBarProps {
  onOpenAiSettings: () => void;
}

export function CodeStatusBar({ onOpenAiSettings }: CodeStatusBarProps) {
  const rootPath = useCodingWorkspaceStore((state) => state.rootPath);
  const editorStatus = useCodingWorkspaceStore(
    useShallow((state) => {
      const group =
        state.groups.find((entry) => entry.id === state.activeGroupId) ?? state.groups[0];
      const tab = group?.activeTabPath
        ? group.tabs.find((entry) => entry.path === group.activeTabPath)
        : null;
      return {
        groupId: group?.id ?? "",
        name: tab?.name ?? null,
        lineEnding: tab?.lineEnding ?? null,
        readonly: tab?.readonly ?? false,
        dirty: tab ? tab.contents !== tab.savedContents : false,
      };
    }),
  );
  const dirtyCount = useCodingWorkspaceStore(
    (state) =>
      state.groups
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.contents !== tab.savedContents).length,
  );
  const gitSnapshot = useGitStore((state) => state.snapshot);
  const cursor = useGroupCursor(editorStatus.groupId);
  const diagnostics = useGroupDiagnostics(editorStatus.groupId);

  const rootName = rootPath ? rootPath.split("/").filter(Boolean).pop() : null;
  const language = labelFor(editorStatus.name ?? undefined);
  const lineEnding = editorStatus.lineEnding === "crlf" ? "CRLF" : "LF";

  return (
    <div className="flex h-6 items-center gap-3.5 border-t border-charcoal-border bg-charcoal-sidebar px-3 font-mono text-[10.5px] text-cream-muted">
      <span
        className="size-1.5 rounded-full bg-[#e8d9c0] shadow-[0_0_0_2px_rgba(232,217,192,0.10)]"
        aria-hidden
      />
      <span>{rootName ?? "No folder"}</span>
      {gitSnapshot?.isRepo ? (
        <span className="inline-flex items-center gap-1">
          <GitBranch size={10} />
          {gitSnapshot.branch ?? "detached"}
          {gitSnapshot.ahead > 0 ? <span>↑{gitSnapshot.ahead}</span> : null}
          {gitSnapshot.behind > 0 ? <span>↓{gitSnapshot.behind}</span> : null}
          {gitSnapshot.files.length > 0 ? (
            <span className="text-cream-muted/80">· {gitSnapshot.files.length} changed</span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        title="Errors from linter / LSP"
        className="inline-flex items-center gap-1 hover:text-cream"
      >
        <AlertCircle size={10} className={diagnostics.errors > 0 ? "text-[#d68b80]" : ""} />
        {diagnostics.errors}
      </button>
      <button
        type="button"
        title="Warnings from linter / LSP"
        className="inline-flex items-center gap-1 hover:text-cream"
      >
        <AlertTriangle size={10} className={diagnostics.warnings > 0 ? "text-[#d4b880]" : ""} />
        {diagnostics.warnings}
      </button>
      {dirtyCount > 0 ? <span>{dirtyCount} unsaved</span> : null}
      <span className="flex-1" />
      {editorStatus.name ? (
        <>
          {cursor ? (
            <span>
              Ln {cursor.line}, Col {cursor.column}
            </span>
          ) : null}
          <span>UTF-8 · {lineEnding} · Spaces 2</span>
          <span>{language}</span>
          <span>
            {editorStatus.name}
            {editorStatus.dirty ? " · modified" : ""}
            {editorStatus.readonly ? " · read only" : ""}
          </span>
        </>
      ) : (
        <span>No file open</span>
      )}
      <button
        type="button"
        onClick={onOpenAiSettings}
        aria-label="AI settings"
        title="AI settings"
        className="inline-flex items-center gap-1 hover:text-cream"
      >
        <Settings2 size={10} />
      </button>
    </div>
  );
}
