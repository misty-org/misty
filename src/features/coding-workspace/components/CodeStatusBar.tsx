import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bot,
  PanelLeft,
  Pin,
  Search,
  SlidersHorizontal,
  SquareTerminal,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  cn,
} from "@/shared/ui";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import { useShortcutTitle } from "@/features/shortcuts";
import type { OpenTab } from "../store/useCodingWorkspaceStore";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useEditorEphemeralStore, useGroupCursor } from "../store/useEditorEphemeralStore";
import type { DockSplitDirection } from "@/features/workspace";

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
  onToggleTerminal: (direction?: DockSplitDirection | "current") => void;
  onOpenDiagnostics?: () => void;
  onOpenAi: () => void;
}

export function CodeStatusBar(props: Props) {
  const dirtyCount = useCodingWorkspaceStore(
    (state) =>
      Object.values(state.projectBuffers[props.rootPath] ?? {}).filter(
        (buffer) => buffer.contents !== buffer.savedContents,
      ).length,
  );
  const cursor = useGroupCursor(props.viewId);
  const diagnostics = useEditorEphemeralStore(
    useShallow((state) => {
      const records = Object.values(state.projectDiagnostics[props.rootPath] ?? {}).flat();
      return {
        errors: records.filter((diagnostic) => diagnostic.severity === "error").length,
        warnings: records.filter((diagnostic) => diagnostic.severity === "warning").length,
      };
    }),
  );
  const editorPreferences = useSettingsStore(
    useShallow((state) => selectEditorPreferences(state.settings?.document)),
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const language = labelFor(props.activeTab?.name);
  const lineEnding = props.activeTab?.lineEnding === "crlf" ? "CRLF" : "LF";

  return (
    <div
      className={cn(
        "code-theme-statusbar flex min-w-0 items-center gap-1 border-t",
        "border-charcoal-border bg-charcoal-sidebar px-1.5 font-mono text-cream-muted",
      )}
    >
      <RailButton
        label="Toggle Explorer"
        commandId="code.toggle_explorer"
        active={props.filesOpen}
        onClick={props.onToggleFiles}
      >
        <PanelLeft />
      </RailButton>
      <RailButton
        label="Harpoon marks and recents"
        commandId="code.harpoon"
        onClick={props.onOpenHarpoon}
      >
        <Pin />
      </RailButton>
      <RailButton
        label="Search project"
        commandId="code.search_project"
        onClick={props.onOpenSearch}
      >
        <Search />
      </RailButton>
      <TerminalDockMenu open={props.terminalOpen} onToggle={props.onToggleTerminal} />

      <span className="code-status-divider" aria-hidden />
      <RailButton label="AI and model settings" onClick={props.onOpenAi}>
        <Bot />
      </RailButton>
      <span className="min-w-2 flex-1" />
      <StatusCount
        label="Errors"
        value={diagnostics.errors}
        danger
        onClick={props.onOpenDiagnostics}
      >
        <AlertCircle />
      </StatusCount>
      <StatusCount label="Warnings" value={diagnostics.warnings} onClick={props.onOpenDiagnostics}>
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
            aria-label="Code display size"
            title="Code display size"
            size="icon"
            className="code-status-action text-cream-muted"
          >
            <SlidersHorizontal />
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

function TerminalDockMenu(props: {
  open: boolean;
  onToggle: (direction?: DockSplitDirection | "current") => void;
}) {
  const title = useShortcutTitle("Terminal dock options", "code.toggle_terminal");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={title}
          title={title}
          aria-pressed={props.open}
          className={cn(
            "code-status-action text-cream-muted",
            props.open && "bg-charcoal-hover text-cream-bright",
          )}
          size="icon"
        >
          <SquareTerminal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        <DropdownMenuLabel>{props.open ? "Terminal" : "Open Terminal"}</DropdownMenuLabel>
        {props.open ? (
          <DropdownMenuItem onSelect={() => props.onToggle()}>Close Terminal</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => props.onToggle("current")}>
              <SquareTerminal size={13} /> In this panel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onToggle("left")}>
              <ArrowLeftToLine size={13} /> Dock left
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onToggle("right")}>
              <ArrowRightToLine size={13} /> Dock right
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onToggle("up")}>
              <ArrowUpToLine size={13} /> Dock above
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onToggle("down")}>
              <ArrowDownToLine size={13} /> Dock below
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RailButton(props: {
  label: string;
  commandId?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const title = useShortcutTitle(props.label, props.commandId ?? "");
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={title}
      title={title}
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        "code-status-action text-cream-muted",
        props.active && "bg-charcoal-hover text-cream-bright",
      )}
      size="icon"
    >
      {props.children}
    </Button>
  );
}

function StatusCount(props: {
  label: string;
  value: number;
  danger?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className = cn(
    "code-status-item inline-flex items-center gap-1 rounded px-1.5 tabular-nums",
    props.onClick && "hover:bg-charcoal-hover focus-visible:outline-none",
    props.value > 0 && (props.danger ? "code-danger" : "code-warning"),
  );
  if (props.onClick) {
    return (
      <button
        type="button"
        title={props.label}
        aria-label={`${props.label}: ${props.value}`}
        onClick={props.onClick}
        className={className}
      >
        {props.children}
        {props.value}
      </button>
    );
  }
  return (
    <span title={props.label} className={className}>
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
