import {
  AlertCircle,
  AlertTriangle,
  Blocks,
  Bot,
  GitBranch,
  PanelLeft,
  Pin,
  Search,
  SlidersHorizontal,
  SquareTerminal,
} from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { useShallow } from "zustand/react/shallow";
import { Button, Popover, PopoverContent, PopoverTrigger, Slider, cn } from "@/shared/ui";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import type { OpenTab } from "../store/useCodingWorkspaceStore";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useGitStore } from "../git/useGitStore";
import { useGroupCursor, useGroupDiagnostics } from "../store/useEditorEphemeralStore";

const LANGUAGE_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  json: "JSON",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  md: "Markdown",
  rs: "Rust",
  py: "Python",
  go: "Go",
  c: "C",
  cpp: "C++",
  cs: "C#",
  java: "Java",
  kt: "Kotlin",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  sql: "SQL",
  xml: "XML",
  sh: "Shell",
  zsh: "Zsh",
  lua: "Lua",
  rb: "Ruby",
  swift: "Swift",
  txt: "Plain Text",
};

interface Props {
  viewId: string;
  rootPath: string;
  activeTab: OpenTab | null;
  filesOpen: boolean;
  terminalOpen: boolean;
  onToggleFiles: () => void;
  onOpenHarpoon: () => void;
  onOpenSearch: () => void;
  onToggleTerminal: () => void;
  onOpenFile: (path: string, name: string) => void;
  onOpenGitHub: () => void;
  onOpenAi: () => void;
  onOpenExtensions: () => void;
}

export function CodeStatusBar(props: Props) {
  const dirtyCount = useCodingWorkspaceStore(
    (state) =>
      Object.values(state.projectBuffers[props.rootPath] ?? {}).filter(
        (buffer) => buffer.contents !== buffer.savedContents,
      ).length,
  );
  const gitSnapshot = useGitStore((state) => state.snapshots[props.rootPath] ?? state.snapshot);
  const refreshGit = useGitStore((state) => state.refresh);
  const cursor = useGroupCursor(props.viewId);
  const diagnostics = useGroupDiagnostics(props.viewId);
  const editorPreferences = useSettingsStore(
    useShallow((state) => selectEditorPreferences(state.settings?.document)),
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const language = labelFor(props.activeTab?.name);
  const lineEnding = props.activeTab?.lineEnding === "crlf" ? "CRLF" : "LF";

  return (
    <div
      className={cn(
        "code-theme-statusbar flex min-w-0 items-center gap-0.5 border-t",
        "border-charcoal-border bg-charcoal-sidebar px-1.5 font-mono text-cream-muted",
      )}
    >
      <RailButton
        label="Toggle Explorer (⌘B)"
        active={props.filesOpen}
        onClick={props.onToggleFiles}
      >
        <PanelLeft />
      </RailButton>
      <RailButton label="Harpoon marks and recents (Ctrl+E)" onClick={props.onOpenHarpoon}>
        <Pin />
      </RailButton>
      <RailButton label="Search project (⌘⇧F)" onClick={props.onOpenSearch}>
        <Search />
      </RailButton>
      <RepositoryControl
        rootPath={props.rootPath}
        onRefresh={() => void refreshGit(props.rootPath)}
        onOpenFile={props.onOpenFile}
      />
      <RailButton
        label="Toggle Terminal (⌘J)"
        active={props.terminalOpen}
        onClick={props.onToggleTerminal}
      >
        <SquareTerminal />
      </RailButton>

      <span className="mx-1 h-3.5 w-px bg-charcoal-border" aria-hidden />
      <RailButton label="GitHub repositories" onClick={props.onOpenGitHub}>
        <FaGithub />
      </RailButton>
      <RailButton label="AI and model settings" onClick={props.onOpenAi}>
        <Bot />
      </RailButton>
      <RailButton label="Extensions" onClick={props.onOpenExtensions}>
        <Blocks />
      </RailButton>

      <span className="min-w-2 flex-1" />
      {gitSnapshot?.isRepo ? (
        <span className="hidden min-w-0 items-center gap-1 truncate px-1 @min-[720px]:inline-flex">
          <GitBranch className="code-status-icon" /> {gitSnapshot.branch ?? "detached"}
          {gitSnapshot.files.length ? ` · ${gitSnapshot.files.length}` : ""}
        </span>
      ) : null}
      <StatusCount label="Errors" value={diagnostics.errors} danger>
        <AlertCircle />
      </StatusCount>
      <StatusCount label="Warnings" value={diagnostics.warnings}>
        <AlertTriangle />
      </StatusCount>
      {dirtyCount ? (
        <span className="hidden px-1 @min-[620px]:inline">{dirtyCount} unsaved</span>
      ) : null}
      {cursor ? (
        <span className="hidden px-1 @min-[760px]:inline">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      ) : null}
      {props.activeTab ? (
        <>
          <span className="hidden px-1 @min-[860px]:inline">UTF-8 · {lineEnding}</span>
          <span className="hidden px-1 @min-[660px]:inline">{language}</span>
        </>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Code display size"
            title="Code display size"
            className="text-cream-muted"
          >
            <SlidersHorizontal className="code-status-icon" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="code-theme-overlay w-72 space-y-4">
          <div>
            <p className="text-sm font-medium text-cream-bright">Code display size</p>
            <p className="mt-1 text-xs text-cream-muted">
              Editor text and controls scale independently.
            </p>
          </div>
          <SizeControl
            label="Editor text"
            value={editorPreferences.fontSize}
            min={8}
            max={32}
            step={0.5}
            formatted={`${editorPreferences.fontSize}px`}
            onCommit={(value) => updateSetting("editor", "font_size", value)}
          />
          <SizeControl
            label="Interface"
            value={editorPreferences.interfaceScale}
            min={0.8}
            max={1.5}
            step={0.1}
            formatted={`${Math.round(editorPreferences.interfaceScale * 100)}%`}
            onCommit={(value) => updateSetting("editor", "interface_scale", value)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RepositoryControl(props: {
  rootPath: string;
  onRefresh: () => void;
  onOpenFile: (path: string, name: string) => void;
}) {
  const snapshot = useGitStore((state) => state.snapshots[props.rootPath] ?? state.snapshot);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Repository status"
          title="Repository status"
          className="text-cream-muted"
        >
          <GitBranch className="code-status-icon" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="code-theme-overlay w-80 p-2">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
          <GitBranch size={13} />
          <strong className="min-w-0 flex-1 truncate text-cream-bright">
            {snapshot?.isRepo ? (snapshot.branch ?? "Detached HEAD") : "Not a Git repository"}
          </strong>
          <Button type="button" variant="ghost" size="sm" onClick={props.onRefresh}>
            Refresh
          </Button>
        </div>
        {snapshot?.files.length ? (
          <div className="max-h-64 overflow-y-auto border-t border-charcoal-border pt-1">
            {snapshot.files.map((file) => (
              <button
                type="button"
                key={file.absolutePath}
                onClick={() =>
                  props.onOpenFile(file.absolutePath, file.path.split("/").pop() ?? file.path)
                }
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-charcoal-hover"
              >
                <span className="code-warning w-4 text-center">
                  {file.status.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-2 py-3 text-xs text-cream-muted">
            {snapshot?.isRepo ? "Working tree is clean." : props.rootPath}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RailButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        "text-cream-muted [&_svg]:code-status-icon",
        props.active && "bg-charcoal-hover text-cream-bright",
      )}
    >
      {props.children}
    </Button>
  );
}

function StatusCount(props: {
  label: string;
  value: number;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      title={props.label}
      className={cn(
        "inline-flex items-center gap-0.5 px-0.5 [&_svg]:code-status-icon",
        props.value > 0 && (props.danger ? "code-danger" : "code-warning"),
      )}
    >
      {props.children}
      {props.value}
    </span>
  );
}

function labelFor(name: string | undefined) {
  if (!name) return "";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_LABELS[extension] ?? (extension ? extension.toUpperCase() : "Plain Text");
}

function SizeControl(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatted: string;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="block text-xs text-cream-muted">
      <span className="mb-2 flex items-center justify-between">
        <span>{props.label}</span>
        <span className="tabular-nums text-cream-bright">{props.formatted}</span>
      </span>
      <Slider
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueCommit={(values) => {
          const value = values[0];
          if (typeof value === "number") props.onCommit(value);
        }}
      />
    </label>
  );
}
