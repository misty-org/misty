import { Command } from "cmdk";
import { FileCode, PanelBottom, PanelLeft, Search, Settings2, SplitSquareHorizontal, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/shared/ui";
import { codeFindInFiles, codeWalkFiles, type SearchMatch, type WalkedFile } from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { openFileInWorkspace } from "../openFile";

export type QuickInputMode = "commands" | "files" | "search";

interface QuickInputProps {
  mode: QuickInputMode | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function QuickInput({ mode, onClose, onOpenSettings }: QuickInputProps) {
  const rootPath = useCodingWorkspaceStore((state) => state.rootPath);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<WalkedFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  useEffect(() => {
    setQuery("");
    setMatches([]);
    setSearchNote(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "files" || !rootPath || files.length > 0) return;
    setFilesLoading(true);
    codeWalkFiles(rootPath)
      .then((walked) => setFiles(walked))
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false));
  }, [mode, rootPath, files.length]);

  useEffect(() => {
    if (mode !== "search" || !rootPath) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      setSearchNote(trimmed.length === 0 ? null : "Type at least 2 characters.");
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchNote(null);
    const timer = window.setTimeout(async () => {
      try {
        const outcome = await codeFindInFiles(rootPath, trimmed, false);
        if (controller.signal.aborted) return;
        setMatches(outcome.matches);
        setSearchNote(
          outcome.truncated
            ? "Showing first 2,000 matches."
            : `${outcome.matches.length} match${outcome.matches.length === 1 ? "" : "es"} (${
                outcome.usedRipgrep ? "rg" : "native"
              })`,
        );
      } catch (error) {
        setMatches([]);
        setSearchNote(error instanceof Error ? error.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mode, rootPath, query]);

  useEffect(() => {
    if (!mode) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mode, onClose]);

  const commands = useMemo(
    () => [
      {
        id: "toggle-files",
        label: "Toggle files panel",
        shortcut: "⌘B",
        icon: <PanelLeft size={14} />,
        run: () => useCodingWorkspaceStore.getState().toggleFilesPane(),
      },
      {
        id: "toggle-terminal",
        label: "Toggle terminal panel",
        shortcut: "⌘J",
        icon: <PanelBottom size={14} />,
        run: () => useCodingWorkspaceStore.getState().toggleTerminalPane(),
      },
      {
        id: "split-editor",
        label: "Split editor right",
        shortcut: "⌘\\",
        icon: <SplitSquareHorizontal size={14} />,
        run: () => useCodingWorkspaceStore.getState().splitActiveTab(),
      },
      {
        id: "new-terminal",
        label: "New terminal tab",
        icon: <Terminal size={14} />,
        run: () => useCodingWorkspaceStore.getState().addTerminalTab(),
      },
      {
        id: "ai-settings",
        label: "AI settings…",
        icon: <Settings2 size={14} />,
        run: () => onOpenSettings(),
      },
    ],
    [onOpenSettings],
  );

  const runCommand = useCallback(
    (id: string) => {
      const command = commands.find((entry) => entry.id === id);
      if (!command) return;
      onClose();
      command.run();
    },
    [commands, onClose],
  );

  const handleFileSelect = useCallback(
    (path: string, name: string) => {
      onClose();
      openFileInWorkspace(path, name);
    },
    [onClose],
  );

  const handleSearchSelect = useCallback(
    (path: string, name: string, line: number) => {
      onClose();
      openFileInWorkspace(path, name, line);
    },
    [onClose],
  );

  if (!mode) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Quick input"
      className="fixed inset-0 z-40 grid place-items-start pt-[10vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        onClick={(event) => event.stopPropagation()}
        className="relative mx-auto w-[560px] overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card shadow-2xl"
      >
        <Command shouldFilter={mode !== "search"} loop label={promptLabel(mode)}>
          <div className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2 text-cream-muted">
            {mode === "search" ? <Search size={14} /> : mode === "files" ? <FileCode size={14} /> : <Command.Loading />}
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={placeholderFor(mode)}
              className="h-7 flex-1 bg-transparent text-sm text-cream-bright outline-none placeholder:text-cream-muted"
            />
            <kbd className="rounded border border-charcoal-border px-1.5 text-[10px] text-cream-muted">
              esc
            </kbd>
          </div>
          <Command.List className="max-h-[52vh] overflow-y-auto py-2">
            <Command.Empty className="px-3 py-6 text-center text-xs text-cream-muted">
              {mode === "files"
                ? filesLoading
                  ? "Indexing…"
                  : "No files match."
                : mode === "search"
                  ? searching
                    ? "Searching…"
                    : searchNote ?? "Type to search across files."
                  : "No commands match."}
            </Command.Empty>

            {mode === "commands"
              ? commands.map((command) => (
                  <Command.Item
                    key={command.id}
                    value={command.label}
                    onSelect={() => runCommand(command.id)}
                    className={cn(itemClass)}
                  >
                    <span className="grid size-5 place-items-center text-cream-muted">
                      {command.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-cream">{command.label}</span>
                    {command.shortcut ? (
                      <kbd className="rounded border border-charcoal-border px-1.5 text-[10px] text-cream-muted">
                        {command.shortcut}
                      </kbd>
                    ) : null}
                  </Command.Item>
                ))
              : null}

            {mode === "files"
              ? files
                  .slice(0, 400)
                  .map((file) => (
                    <Command.Item
                      key={file.path}
                      value={`${file.name} ${file.relative}`}
                      onSelect={() => handleFileSelect(file.path, file.name)}
                      className={cn(itemClass)}
                    >
                      <span className="grid size-5 place-items-center text-cream-muted">
                        <FileCode size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-cream">{file.name}</span>
                        <span className="block truncate text-[11px] text-cream-muted">
                          {file.relative}
                        </span>
                      </span>
                    </Command.Item>
                  ))
              : null}

            {mode === "search"
              ? matches.slice(0, 300).map((match) => (
                  <Command.Item
                    key={`${match.path}:${match.lineNumber}:${match.column}`}
                    value={`${match.relative}:${match.lineNumber}:${match.line}`}
                    onSelect={() => handleSearchSelect(match.path, basename(match.relative), match.lineNumber)}
                    className={cn(itemClass, "items-start py-2")}
                  >
                    <span className="grid size-5 place-items-center text-cream-muted">
                      <Search size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-cream-muted">
                        {match.relative}:{match.lineNumber}
                      </span>
                      <span className="block truncate font-mono text-[12px] text-cream">
                        {match.line}
                      </span>
                    </span>
                  </Command.Item>
                ))
              : null}
          </Command.List>
          {mode === "search" && searchNote ? (
            <div className="border-t border-charcoal-border px-3 py-1.5 text-[10px] text-cream-muted">
              {searchNote}
            </div>
          ) : null}
        </Command>
      </div>
    </div>
  );
}

const itemClass = [
  "flex cursor-pointer items-center gap-2 rounded-md mx-2 px-2 py-1.5 text-sm text-cream",
  "data-[selected=true]:bg-charcoal-hover data-[selected=true]:text-cream-bright",
].join(" ");

function promptLabel(mode: QuickInputMode): string {
  switch (mode) {
    case "files":
      return "Open file";
    case "search":
      return "Search in files";
    default:
      return "Command palette";
  }
}

function placeholderFor(mode: QuickInputMode): string {
  switch (mode) {
    case "files":
      return "Search files by name…";
    case "search":
      return "Search text in files…";
    default:
      return "Type a command…";
  }
}

function basename(relative: string): string {
  const parts = relative.split("/");
  return parts[parts.length - 1] ?? relative;
}
