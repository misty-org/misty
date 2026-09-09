import { Command } from "cmdk";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileCode,
  ListTree,
  Pin,
  PinOff,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, cn } from "@/shared/ui";
import { useDismissableLayer } from "@/shared/hooks/useDismissableLayer";
import type { ComponentType } from "react";
import type { SearchMatch, SearchOutcome, WalkedFile } from "../native";
import { projectState, type createCodingWorkspaceStore } from "../store/createCodingWorkspaceStore";
import { rankFiles } from "./rankCodeFiles";
import { createCodeTopActionMenu } from "./createCodeTopActionMenu";
export { rankFiles } from "./rankCodeFiles";

export interface CodeCommandCenterServices {
  events: EventTarget;
  store: ReturnType<typeof createCodingWorkspaceStore>;
  loadIndex(
    root: string,
  ): Promise<{ files: WalkedFile[]; truncated?: boolean; skippedDirectories?: number }>;
  search(
    root: string,
    query: string,
    caseSensitive: boolean,
    signal: AbortSignal,
  ): Promise<SearchOutcome & { skippedFiles?: number; skippedDirectories?: number }>;
  subscribeIndex(root: string, listener: () => void): () => void;
  ShortcutHint: ComponentType<{ commandId: string }>;
}

export type CommandCenterMode = "files" | "commands" | "search" | "harpoon";

export interface CodeCommand {
  id: string;
  label: string;
  shortcutCommandId?: string;
  shortcut?: string;
  icon?: React.ReactNode;
  run: () => void;
}

export interface CodeTopAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  run?: () => void;
  menu?: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    label: string;
    emptyLabel: string;
    items: CodeCommand[];
  };
}

interface Props {
  viewId: string;
  rootPath: string;
  activePath: string | null;
  symbolContext?: string | null;
  mode: CommandCenterMode | null;
  onModeChange: (mode: CommandCenterMode | null) => void;
  onOpenFile: (path: string, name: string, line?: number) => void;
  onOpenFileInNewTab: (path: string, name: string, line?: number) => void;
  onOpenSearchResults: (query: string) => void;
  onPreviousFile: () => void;
  onNextFile?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  commands: CodeCommand[];
  topActions?: CodeTopAction[];
}

export function createCodeCommandCenter(services: CodeCommandCenterServices) {
  const { store: useCodingWorkspaceStore, ShortcutHint } = services;
  const CodeTopActionMenu = createCodeTopActionMenu(ShortcutHint);
  function CodeCommandCenter(props: Props) {
    const [query, setQuery] = useState("");
    const [files, setFiles] = useState<WalkedFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [matches, setMatches] = useState<SearchMatch[]>([]);
    const [searching, setSearching] = useState(false);
    const [indexVersion, setIndexVersion] = useState(0);
    const [indexNotice, setIndexNotice] = useState<string | null>(null);
    const [searchNotice, setSearchNotice] = useState<string | null>(null);
    const openInNewRef = useRef(false);
    const paletteRef = useRef<HTMLDivElement | null>(null);
    const project = useCodingWorkspaceStore((state) =>
      projectState(state.projects[props.rootPath]),
    );
    const toggleMark = useCodingWorkspaceStore((state) => state.toggleMark);
    const moveMark = useCodingWorkspaceStore((state) => state.moveMark);
    const marked = Boolean(props.activePath && project.marks.includes(props.activePath));

    useDismissableLayer({
      active: props.mode !== null,
      layerRef: paletteRef,
      onDismiss: () => props.onModeChange(null),
    });

    useEffect(() => {
      setFiles([]);
      setIndexNotice(null);
      setLoading(true);
      let active = true;
      void services
        .loadIndex(props.rootPath)
        .then((index) => {
          if (!active) return;
          setFiles(index.files);
          setIndexNotice(
            index.truncated || index.skippedDirectories
              ? "Some project files could not be indexed."
              : null,
          );
        })
        .catch((error: unknown) => {
          if (!active) return;
          setFiles([]);
          setIndexNotice(error instanceof Error ? error.message : "Could not index this project.");
        })
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [indexVersion, props.rootPath]);

    useEffect(() => {
      let timer: number | null = null;
      const remove = services.subscribeIndex(props.rootPath, () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => setIndexVersion((version) => version + 1), 250);
      });
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        remove();
      };
    }, [props.rootPath]);

    useEffect(() => {
      if (!props.mode) setQuery("");
    }, [props.mode]);

    useEffect(() => {
      if (props.mode !== "search") {
        setSearching(false);
        return;
      }
      setSearchNotice(null);
      setMatches([]);
      const trimmed = query.replace(/^\//, "").trim();
      if (trimmed.length < 2) {
        setMatches([]);
        setSearching(false);
        return;
      }
      let active = true;
      setSearching(true);
      const abort = new AbortController();
      const timer = window.setTimeout(() => {
        void services
          .search(props.rootPath, trimmed, false, abort.signal)
          .then((outcome) => {
            if (!active) return;
            setMatches(outcome.matches);
            setSearchNotice(
              outcome.truncated || outcome.skippedFiles || outcome.skippedDirectories
                ? "Search is incomplete. Some files were skipped or a search limit was reached."
                : null,
            );
          })
          .catch((error: unknown) => {
            if (!active) return;
            setMatches([]);
            setSearchNotice(
              error instanceof Error ? error.message : "Could not search this project.",
            );
          })
          .finally(() => active && setSearching(false));
      }, 180);
      return () => {
        active = false;
        abort.abort();
        window.clearTimeout(timer);
      };
    }, [props.mode, props.rootPath, query, indexVersion]);

    const relativeActive = props.activePath
      ? props.activePath.slice(props.rootPath.length).replace(/^\//, "")
      : "";
    const rankedFiles = useMemo(() => rankFiles(files, query, 500), [files, query]);
    const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
    const harpoonFiles = useMemo(() => {
      const marks = project.marks.map((path) => ({
        path,
        file: fileByPath.get(path),
        marked: true,
      }));
      const recents = project.recents
        .filter((path) => !project.marks.includes(path) && fileByPath.has(path))
        .map((path) => ({ path, file: fileByPath.get(path), marked: false }));
      return [...marks, ...recents];
    }, [fileByPath, project.marks, project.recents]);

    const choose = (path: string, name: string, line?: number) => {
      const openInNew = openInNewRef.current;
      openInNewRef.current = false;
      props.onModeChange(null);
      if (openInNew) props.onOpenFileInNewTab(path, name, line);
      else props.onOpenFile(path, name, line);
    };

    return (
      <div className="code-command-center relative flex min-w-0 items-center gap-1 border-b border-charcoal-border bg-charcoal-sidebar px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Back"
          title="Back"
          onClick={props.onPreviousFile}
          disabled={!props.canGoBack}
          className="text-cream-muted"
        >
          <ArrowLeft className="code-status-icon" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Next file"
          title="Next file"
          onClick={props.onNextFile}
          disabled={!props.onNextFile || !props.canGoForward}
          className="text-cream-muted"
        >
          <ArrowRight className="code-status-icon" />
        </Button>
        <div ref={paletteRef} className="code-command-field relative min-w-0">
          {props.mode ? (
            <Command
              className="w-full"
              shouldFilter={props.mode !== "search" && props.mode !== "files"}
              loop
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const line = lineNumberForInput(query);
                  if (line !== null && props.activePath) {
                    event.preventDefault();
                    props.onModeChange(null);
                    services.events.dispatchEvent(
                      new CustomEvent("misty:code-goto-line", {
                        detail: { path: props.activePath, line, viewId: props.viewId },
                      }),
                    );
                    return;
                  }
                  openInNewRef.current = event.metaKey || event.ctrlKey;
                }
              }}
            >
              <div className="flex h-7 items-center gap-2 rounded-md border border-charcoal-border bg-charcoal-card px-2">
                {props.mode === "search" ? (
                  <Search size={13} />
                ) : props.mode === "harpoon" ? (
                  <Pin size={13} />
                ) : (
                  <FileCode size={13} />
                )}
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={(value) => {
                    const prefixedMode = commandCenterModeForInput(value);
                    if (props.mode === "files" && prefixedMode === "commands") {
                      setQuery(value.slice(1));
                      props.onModeChange("commands");
                    } else if (props.mode === "files" && prefixedMode === "search") {
                      setQuery(value.slice(1));
                      props.onModeChange("search");
                    } else setQuery(value);
                  }}
                  placeholder={placeholder(props.mode)}
                  className="min-w-0 flex-1 bg-transparent text-xs text-cream-bright outline-none placeholder:text-cream-muted"
                />
                <kbd className="text-[10px] text-cream-muted">esc</kbd>
              </div>
              <Command.List
                className={cn(
                  "code-command-results absolute left-0 right-0 top-[33px] z-50 max-h-[52vh]",
                  "overflow-y-auto rounded-b-lg border border-t-0 border-charcoal-border",
                  "bg-charcoal-card py-1 shadow-2xl",
                )}
              >
                {(props.mode === "search" ? searchNotice : indexNotice) && (
                  <p role="status" className="px-3 py-2 text-xs text-cream-muted">
                    {props.mode === "search" ? searchNotice : indexNotice}
                  </p>
                )}
                <Command.Empty className="px-3 py-5 text-center text-xs text-cream-muted">
                  {loading || searching ? "Searching…" : "No matches."}
                </Command.Empty>
                {props.mode === "files"
                  ? rankedFiles.map((file) => (
                      <FileResult
                        key={file.path}
                        file={file}
                        onChoose={() => choose(file.path, file.name)}
                      />
                    ))
                  : null}
                {props.mode === "commands"
                  ? props.commands.map((command) => (
                      <Command.Item
                        key={command.id}
                        value={command.label}
                        onSelect={() => {
                          props.onModeChange(null);
                          command.run();
                        }}
                        className={itemClass}
                      >
                        <span className="grid size-5 place-items-center text-cream-muted">
                          {command.icon ?? <ListTree size={13} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{command.label}</span>
                        {command.shortcutCommandId ? (
                          <ShortcutHint commandId={command.shortcutCommandId} />
                        ) : command.shortcut ? (
                          <kbd className="text-[10px] text-cream-muted">{command.shortcut}</kbd>
                        ) : null}
                      </Command.Item>
                    ))
                  : null}
                {props.mode === "search"
                  ? [
                      ...(matches.length > 0
                        ? [
                            <Command.Item
                              key="__open-search-results__"
                              value={`Open ${matches.length} matches in a multibuffer`}
                              onSelect={() => {
                                props.onModeChange(null);
                                props.onOpenSearchResults(query);
                              }}
                              className={cn(itemClass, "font-medium text-cream-bright")}
                            >
                              <ListTree size={13} />
                              <span className="min-w-0 flex-1">
                                Open {matches.length} matches in a multibuffer
                              </span>
                              <kbd className="text-[10px] text-cream-muted">↵</kbd>
                            </Command.Item>,
                          ]
                        : []),
                      ...matches.slice(0, 300).map((match) => (
                        <Command.Item
                          key={`${match.path}:${match.lineNumber}:${match.column}`}
                          value={`${match.relative}:${match.lineNumber}:${match.line}`}
                          onSelect={() =>
                            choose(match.path, basename(match.path), match.lineNumber)
                          }
                          className={cn(itemClass, "items-start py-2")}
                        >
                          <Search size={12} className="mt-0.5 shrink-0 text-cream-muted" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[10px] text-cream-muted">
                              {match.relative}:{match.lineNumber}
                            </span>
                            <span className="block truncate font-mono text-xs">{match.line}</span>
                          </span>
                        </Command.Item>
                      )),
                    ]
                  : null}
                {props.mode === "harpoon"
                  ? harpoonFiles.map(({ path, file, marked: isMark }, index) => (
                      <Command.Item
                        key={path}
                        value={`${file?.name ?? basename(path)} ${file?.relative ?? path}`}
                        disabled={!file}
                        onSelect={() => file && choose(path, file.name)}
                        className={cn(itemClass, !file && "opacity-50")}
                      >
                        {isMark ? <Pin size={12} /> : <FileCode size={12} />}
                        <span className="min-w-0 flex-1 truncate">{file?.relative ?? path}</span>
                        {isMark && index < 4 ? (
                          <ShortcutHint commandId={`code.mark_${index + 1}`} />
                        ) : null}
                        {isMark ? (
                          <span
                            className="flex items-center gap-0.5"
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              aria-label="Move mark up"
                              disabled={index === 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                moveMark(props.rootPath, path, -1);
                              }}
                              className="grid size-5 place-items-center rounded hover:bg-charcoal-active disabled:opacity-30"
                            >
                              <ChevronUp size={11} />
                            </button>
                            <button
                              type="button"
                              aria-label="Move mark down"
                              disabled={index === project.marks.length - 1}
                              onClick={(event) => {
                                event.stopPropagation();
                                moveMark(props.rootPath, path, 1);
                              }}
                              className="grid size-5 place-items-center rounded hover:bg-charcoal-active disabled:opacity-30"
                            >
                              <ChevronDown size={11} />
                            </button>
                            <button
                              type="button"
                              aria-label="Remove mark"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleMark(props.rootPath, path);
                              }}
                              className="grid size-5 place-items-center rounded hover:bg-charcoal-active"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ) : null}
                      </Command.Item>
                    ))
                  : null}
              </Command.List>
            </Command>
          ) : (
            <button
              type="button"
              onClick={() => props.onModeChange("files")}
              className={cn(
                "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs",
                "text-cream-muted hover:bg-charcoal-card hover:text-cream",
              )}
              aria-label="Open file or command"
            >
              <Search size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono">
                {relativeActive
                  ? `${relativeActive}${props.symbolContext ? ` › ${props.symbolContext}` : ""}`
                  : "Search files or type > for commands…"}
              </span>
              <ShortcutHint commandId="code.quick_open" />
            </button>
          )}
        </div>
        <span className="min-w-0 flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={marked ? "Remove Harpoon mark" : "Add Harpoon mark"}
          title={marked ? "Remove Harpoon mark" : "Add Harpoon mark"}
          disabled={!props.activePath}
          onClick={() => props.activePath && toggleMark(props.rootPath, props.activePath)}
          className={cn("text-cream-muted", marked && "code-accent")}
        >
          {marked ? <PinOff className="code-status-icon" /> : <Pin className="code-status-icon" />}
        </Button>
        {(props.topActions ?? []).map((action) =>
          action.menu ? (
            <CodeTopActionMenu key={action.id} action={action} />
          ) : (
            <Button
              key={action.id}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={action.label}
              title={action.label}
              aria-pressed={action.active}
              disabled={action.disabled}
              onClick={action.run}
              className={cn(
                "text-cream-muted",
                action.active && "bg-charcoal-hover text-cream-bright",
              )}
            >
              {action.icon}
            </Button>
          ),
        )}
      </div>
    );
  }

  return CodeCommandCenter;
}

export function commandCenterModeForInput(value: string): CommandCenterMode | null {
  if (value.startsWith(">")) return "commands";
  if (value.startsWith("/")) return "search";
  if (value.startsWith(":")) return "files";
  return null;
}

export function lineNumberForInput(value: string): number | null {
  const match = /^:(\d+)$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function FileResult({ file, onChoose }: { file: WalkedFile; onChoose: () => void }) {
  return (
    <Command.Item value={`${file.name} ${file.relative}`} onSelect={onChoose} className={itemClass}>
      <FileCode size={13} className="shrink-0 text-cream-muted" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="max-w-[55%] truncate text-[10px] text-cream-muted">{file.relative}</span>
    </Command.Item>
  );
}

const itemClass = cn(
  "mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-cream outline-none",
  "data-[selected=true]:bg-charcoal-hover data-[selected=true]:text-cream-bright",
);

function placeholder(mode: CommandCenterMode) {
  if (mode === "commands") return "Run a command…";
  if (mode === "search") return "Search project contents…";
  if (mode === "harpoon") return "Marks and recent files…";
  return "Search files…  (> commands, / content)";
}

function basename(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}
