import type { RefObject } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/ui";
import { ModeIcon } from "./GlobalMistyPanelContent";
import type { GlobalAiMode } from "./types";

const modes: GlobalAiMode[] = ["search", "ask", "action"];

interface LauncherOption {
  label: string;
  prompt: string;
  mode: GlobalAiMode;
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
  onExpand: () => void;
}) {
  const options = launcherOptions(props.currentPath);
  const cycleMode = (direction = 1) => {
    const currentIndex = modes.indexOf(props.mode);
    props.onModeChange(modes[(currentIndex + direction + modes.length) % modes.length]);
  };

  return (
    <motion.div
      ref={props.launcherRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="pointer-events-auto mx-auto w-[min(760px,calc(100dvw-128px))] rounded-2xl border border-charcoal-border bg-charcoal-card p-3 text-cream shadow-[0_20px_64px_rgba(0,0,0,0.55)] transition-colors focus-within:border-charcoal-active focus-within:ring-1 focus-within:ring-charcoal-active/40"
      aria-label="Open Misty — Search, Ask, or Action"
      onClick={() => props.inputRef.current?.focus()}
    >
      <div className="flex min-h-12 items-center gap-3">
        <button
          type="button"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-charcoal-hover text-cream transition hover:bg-charcoal-active"
          aria-label={`${capitalize(props.mode)} mode. Click or press Tab to switch.`}
          title={`${capitalize(props.mode)} · Tab to switch`}
          onClick={(event) => {
            event.stopPropagation();
            cycleMode();
            props.inputRef.current?.focus();
          }}
        >
          {props.working ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ModeIcon mode={props.mode} className="size-[18px] text-cream-bright" />
          )}
        </button>
        <input
          ref={props.inputRef}
          data-global-misty-launcher-input
          value={props.query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            props.onQueryChange(nextQuery);
            if (nextQuery.trim()) props.onExpand();
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              cycleMode(event.shiftKey ? -1 : 1);
              return;
            }
            if (event.key === "Enter" && props.query.trim()) {
              event.preventDefault();
              props.onExpand();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-base text-cream outline-none placeholder:text-cream-muted"
          placeholder="Search, ask, or take action…"
          aria-label="Misty prompt"
        />
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0 rounded-xl bg-cream text-charcoal-bg hover:bg-cream-bright"
          disabled={!props.query.trim()}
          aria-label="Expand Misty"
          onClick={(event) => {
            event.stopPropagation();
            props.onExpand();
          }}
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>
      <div className="mt-2 flex min-h-8 items-center gap-1 border-t border-charcoal-border/70 pt-2">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-cream-muted transition hover:bg-charcoal-hover hover:text-cream"
            onClick={(event) => {
              event.stopPropagation();
              props.onModeChange(option.mode);
              props.onQueryChange(option.prompt);
              props.onExpand();
            }}
          >
            <ModeIcon mode={option.mode} />
            {option.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function launcherOptions(path: string): LauncherOption[] {
  if (path.startsWith("/spaces/"))
    return [
      {
        label: "Summarize this Space",
        prompt: "Summarize recent updates in this Space",
        mode: "ask",
      },
      { label: "Create task", prompt: "Create a task in this Space", mode: "action" },
    ];
  if (path.startsWith("/files"))
    return [
      { label: "Search current folder", prompt: "Search this folder", mode: "search" },
      { label: "Summarize selection", prompt: "Summarize the selected files", mode: "ask" },
    ];
  if (path.startsWith("/agents"))
    return [
      { label: "Find an Agent", prompt: "Find an Agent for this work", mode: "search" },
      { label: "Create workflow", prompt: "Create an Agent workflow", mode: "action" },
    ];
  if (path.startsWith("/extensions"))
    return [
      { label: "Find an extension", prompt: "Find an extension", mode: "search" },
      { label: "Recommend extensions", prompt: "Recommend extensions for my work", mode: "ask" },
    ];
  return [
    { label: "Summarize updates", prompt: "Summarize my recent updates", mode: "ask" },
    { label: "Create task", prompt: "Create a task", mode: "action" },
  ];
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
