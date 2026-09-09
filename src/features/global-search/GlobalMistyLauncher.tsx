import { invokeShortcutCommand, ShortcutHint, shortcutCommandRegistry } from "@/features/shortcuts";
import {
  dockLeaves,
  dockTabs,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace/core";
import { Button } from "@/shared/ui";
import { ArrowUp, Clock3, Command, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { ModeIcon } from "./GlobalMistyPanelContent";
import type { GlobalAiMode } from "./types";

const modes: GlobalAiMode[] = ["search"];
const launcherClass = [
  "pointer-events-auto mx-auto w-[min(760px,calc(100dvw-128px))] overflow-hidden rounded-2xl",
  "border border-charcoal-border bg-charcoal-card p-3 text-cream",
  "shadow-[0_20px_64px_rgba(0,0,0,0.55)] transition-colors",
  "focus-within:border-charcoal-active focus-within:ring-1 focus-within:ring-charcoal-active/40",
].join(" ");
const coreToolCommandIds = [
  "tool.home",
  "tool.journal",
  "tool.planner",
  "tool.social",
  "tool.inbox",
  "tool.library",
  "tool.browser",
  "tool.files",
  "tool.code",
];

interface CommandResult {
  id: string;
  label: string;
  description: string;
  commandId?: string;
  tabId?: string;
  recent?: boolean;
}

export function GlobalMistyLauncher(props: {
  currentPath: string;
  mode: GlobalAiMode;
  query: string;
  working: boolean;
  launcherRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  onModeChange: (mode: GlobalAiMode) => void;
  onQueryChange: (query: string) => void;
  onDismiss: () => void;
  onExpand: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commandOnly = props.query.trimStart().startsWith(">");
  const commandQuery = (commandOnly ? props.query.trimStart().slice(1) : props.query)
    .trim()
    .toLowerCase();
  const workspaceSignature = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root)
      .flatMap((pane) => pane.tabs)
      .map((tab) => `${tab.id}:${tab.lastFocusedAt}`)
      .join("|"),
  );
  const results = useMemo(
    () => launcherCommandResults(commandQuery, commandOnly, workspaceSignature),
    [commandOnly, commandQuery, workspaceSignature],
  );

  useEffect(() => setSelectedIndex(0), [commandOnly, commandQuery]);

  const cycleMode = (direction = 1) => {
    const currentIndex = modes.indexOf(props.mode);
    props.onModeChange(modes[(currentIndex + direction + modes.length) % modes.length]);
  };
  const runResult = (result: CommandResult) => {
    props.onDismiss();
    if (result.commandId) invokeShortcutCommand(result.commandId);
    else if (result.tabId)
      window.dispatchEvent(
        new CustomEvent("misty:focus-workspace-tab", { detail: { tabId: result.tabId } }),
      );
  };

  return (
    <motion.div
      ref={props.launcherRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className={launcherClass}
      aria-label="Open Misty Search"
      onClick={() => props.inputRef.current?.focus()}
    >
      <div className="flex min-h-12 items-center gap-3">
        <button
          type="button"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-charcoal-hover text-cream transition hover:bg-charcoal-active"
          aria-label="Search"
          title="Search"
          onClick={(event) => {
            event.stopPropagation();
            cycleMode();
            props.inputRef.current?.focus();
          }}
        >
          {props.working ? (
            <Loader2 className="size-4 animate-spin" />
          ) : commandOnly ? (
            <Command className="size-[18px] text-cream-bright" />
          ) : (
            <ModeIcon mode={props.mode} className="size-[18px] text-cream-bright" />
          )}
        </button>
        <input
          ref={props.inputRef}
          data-global-misty-launcher-input
          value={props.query}
          onChange={(event) => {
            const value = event.target.value;
            props.onQueryChange(value);
            if (value.trim() && !value.trimStart().startsWith(">")) props.onExpand();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault();
              setSelectedIndex((index) => (index + 1) % results.length);
              return;
            }
            if (event.key === "ArrowUp" && results.length) {
              event.preventDefault();
              setSelectedIndex((index) => (index - 1 + results.length) % results.length);
              return;
            }
            if (event.key === "Tab" && !commandOnly) {
              event.preventDefault();
              cycleMode(event.shiftKey ? -1 : 1);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (results[selectedIndex]) runResult(results[selectedIndex]);
              else if (!commandOnly && props.query.trim()) props.onExpand();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-base text-cream outline-none placeholder:text-cream-muted"
          placeholder={commandOnly ? "Type a command…" : "Search tools, files, and commands…"}
          aria-label="Search Misty"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="misty-launcher-results"
          aria-activedescendant={
            results[selectedIndex] ? `misty-result-${selectedIndex}` : undefined
          }
        />
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0 rounded-xl bg-cream text-charcoal-bg hover:bg-cream-bright"
          disabled={!props.query.trim() || commandOnly}
          aria-label="Search"
          onClick={(event) => {
            event.stopPropagation();
            props.onExpand();
          }}
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>

      {results.length ? (
        <div
          id="misty-launcher-results"
          role="listbox"
          className="mt-2 max-h-[360px] overflow-y-auto border-t border-charcoal-border/70 pt-2"
        >
          {results.map((result, index) => (
            <button
              id={`misty-result-${index}`}
              role="option"
              aria-selected={selectedIndex === index}
              key={result.id}
              type="button"
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                selectedIndex === index ? "bg-charcoal-hover text-cream" : "text-cream-muted"
              }`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={(event) => {
                event.stopPropagation();
                runResult(result);
              }}
            >
              {result.recent ? <Clock3 size={14} /> : <Command size={14} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{result.label}</span>
                <span className="block truncate text-xs text-mist-gray">{result.description}</span>
              </span>
              {result.commandId ? (
                <ShortcutHint commandId={result.commandId} includeAlternate />
              ) : null}
            </button>
          ))}
        </div>
      ) : commandOnly ? (
        <p className="border-t border-charcoal-border/70 px-2 py-5 text-center text-sm text-mist-gray">
          No matching commands.
        </p>
      ) : null}
    </motion.div>
  );
}

function launcherCommandResults(
  query: string,
  commandOnly: boolean,
  _workspaceSignature: string,
): CommandResult[] {
  if (!query) {
    const recent = recentTabs().map((tab) => ({
      id: `recent:${tab.id}`,
      label: tab.title,
      description: "Recent tab",
      tabId: tab.id,
      recent: true,
    }));
    const tools = shortcutCommandRegistry
      .filter((command) => coreToolCommandIds.includes(command.id))
      .map(commandResult);
    return (commandOnly ? tools : [...recent.slice(0, 4), ...tools]).slice(0, 10);
  }
  return shortcutCommandRegistry
    .filter((command) => {
      if (!commandOnly && !command.id.startsWith("tool.") && query.length < 2) return false;
      return [command.label, command.description, command.category, ...command.aliases]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .slice(0, 10)
    .map(commandResult);
}

function commandResult(command: (typeof shortcutCommandRegistry)[number]): CommandResult {
  return {
    id: `command:${command.id}`,
    label: command.label,
    description: `${command.description} · ${scopeLabel(command.scope)}`,
    commandId: command.id,
  };
}

function recentTabs(): WorkspaceTab[] {
  const state = useWorkspaceStore.getState();
  return (state.virtualWindowsByScope[state.activeScopeKey] ?? [])
    .flatMap((window) => dockTabs(window.layout.root))
    .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt);
}

function scopeLabel(scope: string): string {
  if (scope === "global") return "Everywhere";
  if (scope === "workspace") return "Workspace";
  return scope.slice(5).replace(/^./, (character) => character.toUpperCase());
}
