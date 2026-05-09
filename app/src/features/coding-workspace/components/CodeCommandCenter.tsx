import { Command } from "cmdk";
import {
  ArrowLeft,
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
import { codeFindInFiles, codeWalkFiles, type SearchMatch, type WalkedFile } from "../native";
import { projectState, useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

export type CommandCenterMode = "files" | "commands" | "search" | "harpoon";

export interface CodeCommand {
  id: string;
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  run: () => void;
}

interface Props {
  viewId: string;
  rootPath: string;
  activePath: string | null;
  mode: CommandCenterMode | null;
  onModeChange: (mode: CommandCenterMode | null) => void;
  onOpenFile: (path: string, name: string, line?: number) => void;
  onOpenFileInNewTab: (path: string, name: string, line?: number) => void;
  onPreviousFile: () => void;
  commands: CodeCommand[];
}

interface FileIndexCacheEntry {
  files: WalkedFile[];
  dirty: boolean;
  pending: Promise<WalkedFile[]> | null;
}

const fileIndexCache = new Map<string, FileIndexCacheEntry>();

function loadProjectFileIndex(rootPath: string): Promise<WalkedFile[]> {
  const cached = fileIndexCache.get(rootPath) ?? { files: [], dirty: true, pending: null };
  fileIndexCache.set(rootPath, cached);
  if (cached.pending) return cached.pending;
  if (!cached.dirty) return Promise.resolve(cached.files);
  cached.dirty = false;
  cached.pending = codeWalkFiles(rootPath)
    .then((files) => {
      cached.files = files;
      return files;
    })
    .catch((error) => {
      cached.dirty = true;
      throw error;
    })
    .finally(() => {
      cached.pending = null;
    });
  return cached.pending;
}

function invalidateProjectFileIndex(rootPath: string) {
  const cached = fileIndexCache.get(rootPath);
  if (cached) cached.dirty = true;
  else fileIndexCache.set(rootPath, { files: [], dirty: true, pending: null });
}

export function CodeCommandCenter(props: Props) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<WalkedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);
  const openInNewRef = useRef(false);
  const project = useCodingWorkspaceStore((state) => projectState(state.projects[props.rootPath]));
  const toggleMark = useCodingWorkspaceStore((state) => state.toggleMark);
  const moveMark = useCodingWorkspaceStore((state) => state.moveMark);
  const marked = Boolean(props.activePath && project.marks.includes(props.activePath));

  useEffect(() => {
    setFiles([]);
    setLoading(true);
    let active = true;
    void loadProjectFileIndex(props.rootPath)
      .then((walked) => active && setFiles(walked))
      .catch(() => active && setFiles([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [indexVersion, props.rootPath]);

  useEffect(() => {
    let timer: number | null = null;
    const invalidate = (event: Event) => {
      const detail = (event as CustomEvent<{ rootPath?: string }>).detail;
      if (detail?.rootPath !== props.rootPath) return;
      invalidateProjectFileIndex(props.rootPath);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setIndexVersion((version) => version + 1), 250);
    };
    window.addEventListener("misty:code-index-invalidated", invalidate);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("misty:code-index-invalidated", invalidate);
    };
  }, [props.rootPath]);

  useEffect(() => {
    if (!props.mode) setQuery("");
  }, [props.mode]);

  useEffect(() => {
    if (props.mode !== "search") return;
    const trimmed = query.replace(/^\//, "").trim();
    if (trimmed.length < 2) {
      setMatches([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void codeFindInFiles(props.rootPath, trimmed, false)
        .then((outcome) => active && setMatches(outcome.matches))
        .catch(() => active && setMatches([]))
        .finally(() => active && setSearching(false));
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [props.mode, props.rootPath, query]);

  const relativeActive = props.activePath
    ? props.activePath.slice(props.rootPath.length).replace(/^\//, "")
    : "";
  const rankedFiles = useMemo(() => rankFiles(files, query, 500), [files, query]);
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const harpoonFiles = useMemo(() => {
    const marks = project.marks.map((path) => ({ path, file: fileByPath.get(path), marked: true }));
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
        aria-label="Previous file (Ctrl+O)"
        title="Previous file (Ctrl+O)"
        onClick={props.onPreviousFile}
        disabled={project.recents.length < 2}
        className="text-cream-muted"
      >
        <ArrowLeft className="code-status-icon" />
      </Button>
      <div className="relative min-w-0 flex-1">
        {props.mode ? (
          <Command
            className="w-full"
            shouldFilter={props.mode !== "search" && props.mode !== "files"}
            loop
            onKeyDown={(event) => {
              if (event.key === "Escape") props.onModeChange(null);
              if (event.key === "Enter") {
                const line = lineNumberForInput(query);
                if (line !== null && props.activePath) {
                  event.preventDefault();
                  props.onModeChange(null);
                  window.dispatchEvent(
                    new CustomEvent("misty:code-goto-line", {
                      detail: { path: props.activePath, line },
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
                      {command.shortcut ? (
                        <kbd className="text-[10px] text-cream-muted">{command.shortcut}</kbd>
                      ) : null}
                    </Command.Item>
                  ))
                : null}
              {props.mode === "search"
                ? matches.slice(0, 300).map((match) => (
                    <Command.Item
                      key={`${match.path}:${match.lineNumber}:${match.column}`}
                      value={`${match.relative}:${match.lineNumber}:${match.line}`}
                      onSelect={() => choose(match.path, basename(match.path), match.lineNumber)}
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
                  ))
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
                        <kbd className="text-[10px] text-cream-muted">⌥{index + 1}</kbd>
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
              {relativeActive || "Search files or type > for commands…"}
            </span>
            <kbd className="shrink-0 text-[10px]">⌘P</kbd>
          </button>
        )}
      </div>
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
    </div>
  );
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

export function rankFiles(files: WalkedFile[], query: string, limit = 500): WalkedFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle || needle.startsWith(":")) return files.slice(0, limit);
  return files
    .map((file) => {
      const pathScore = fuzzyScore(file.relative.toLowerCase(), needle);
      const nameScore = fuzzyScore(file.name.toLowerCase(), needle);
      return { file, score: Math.max(pathScore, nameScore < 0 ? -1 : nameScore + 2_000) };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.file.relative.length - b.file.relative.length)
    .slice(0, limit)
    .map((entry) => entry.file);
}

function fuzzyScore(value: string, needle: string): number {
  const direct = value.indexOf(needle);
  if (direct >= 0) return 10_000 - direct * 10 - value.length;
  let cursor = 0;
  let score = 0;
  let previous = -2;
  for (const character of needle) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return -1;
    score += index === previous + 1 ? 25 : 5;
    if (index === 0 || "/._-".includes(value[index - 1] ?? "")) score += 20;
    previous = index;
    cursor = index + 1;
  }
  return score - value.length * 0.01;
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
