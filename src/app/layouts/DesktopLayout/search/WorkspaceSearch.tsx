import { Command } from "cmdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { shortAgo, usePersonalAgentsStore } from "@/features/agents";
import type { WorkspaceView } from "@/features/app-windows";
import { ShortcutText, useShortcutHandler } from "@/features/shortcuts";
import { Dialog, DialogContent, DialogTitle, Pressable } from "@/shared/ui";
import { openNewChat, openWorkspaceRoute } from "../spaceNavigation";
import { markParts, type Part } from "./searchRank";
import { readQuery } from "./searchQuery";
import { useSearchDialog, useSearchUses } from "./searchStore";
import { searchKinds, type SearchHit, type SearchKind } from "./searchTypes";
import { useSearchHits } from "./useSearchHits";
import "./search.css";

/**
 * ⌘K search: one box for everything in Misty. It finds chats (by what was said in them too),
 * agents, the Space's notes, messages, tasks, events and files, Tutor's notebooks and lessons,
 * apps to connect, settings, commands and pages, and does what the text asks: `@agent …` asks an
 * agent, `task: …` makes a task, ⌘↵ asks the usual agent. With nothing typed it shows what was
 * opened last. Mounted once per window, so ⌘K works with the sidebar hidden.
 */
export function WorkspaceSearch({ onOpen }: { onOpen(view: WorkspaceView): void }) {
  const open = useSearchDialog((state) => state.open);
  const setOpen = useSearchDialog((state) => state.setOpen);
  useShortcutHandler("app.command_palette", () => {
    const state = useSearchDialog.getState();
    state.setOpen(!state.open);
  });
  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
      <DialogContent
        placement="top"
        className="misty-search max-w-[680px] gap-0 p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        {open ? <SearchBody onOpen={onOpen} close={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Marked({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.marked ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

/** Puts hits under their headings, in the order of each heading's best hit. */
function grouped(hits: SearchHit[], kind: SearchKind, typed: boolean) {
  const groups = new Map<string, SearchHit[]>();
  const cap = kind === "all" ? (typed ? 4 : 8) : 40;
  for (const hit of hits) {
    const heading =
      !typed && hit.group !== "Actions" && kind !== "commands" ? "Recents" : hit.group;
    const list = groups.get(heading) ?? [];
    if (list.length < (heading === "Actions" ? 6 : cap)) list.push(hit);
    groups.set(heading, list);
  }
  return [...groups];
}

function SearchBody({ onOpen, close }: { onOpen(view: WorkspaceView): void; close(): void }) {
  const initial = useSearchDialog((state) => state.initial);
  const [raw, setRaw] = useState(initial);
  const [picked, setPicked] = useState<SearchKind>("all");
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");
  const agents = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => void useSearchUses.getState().load(), []);

  const query = useMemo(
    () =>
      readQuery(
        raw,
        agents.filter((agent) => agent.enabled || agent.system_managed),
      ),
    [raw, agents],
  );
  const kind = query.kind ?? picked;
  const typed = query.text.length > 0;
  const openRoute = useCallback((route: string) => openWorkspaceRoute(route, onOpen), [onOpen]);
  const onNewChat = useCallback(() => openNewChat(onOpen), [onOpen]);
  const { hits, waiting } = useSearchHits({ query, kind, openRoute, onNewChat });
  const groups = useMemo(() => grouped(hits, kind, typed), [hits, kind, typed]);

  const run = async (hit: SearchHit) => {
    if (running) return;
    useSearchUses.getState().note(hit.id);
    setError("");
    let result: void | Promise<void>;
    try {
      result = hit.open();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (!(result instanceof Promise)) {
      close();
      return;
    }
    // Asking an agent or making a task takes a moment; the box stays until it is done.
    setRunning(hit.id);
    try {
      await result;
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn’t go through. Try again.");
    } finally {
      setRunning("");
    }
  };
  /** ⌘↵: what the text asks for, or asking the usual agent. */
  const primary = hits.find(
    (hit) =>
      hit.group === "Actions" &&
      hit.id.startsWith("action:") &&
      hit.id !== "action:new-chat" &&
      (hit.match >= 10 || hit.id === "action:ask"),
  );
  const step = (by: number) => {
    const at = searchKinds.findIndex((item) => item.id === picked);
    setPicked(searchKinds[(at + by + searchKinds.length) % searchKinds.length].id);
  };

  return (
    <Command
      className="misty-search-command"
      shouldFilter={false}
      loop
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (primary) void run(primary);
          return;
        }
        // The arrows change type while nothing is typed; once there is text they move the caret.
        if (raw.trim() || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <Command.Input
        className="misty-search-input"
        placeholder="Search, or type @agent, task:, > for commands"
        value={raw}
        onValueChange={(value) => {
          setRaw(value);
          setError("");
        }}
        autoFocus
      />
      <div className="misty-search-kinds" role="tablist" aria-label="Type">
        {searchKinds.map((item) => (
          <Pressable
            key={item.id}
            type="button"
            role="tab"
            aria-selected={kind === item.id}
            className="misty-search-kind"
            onClick={() => {
              setPicked(item.id);
              // A tab replaces a prefix that chose another.
              if (query.kind && query.kind !== item.id) setRaw(query.text);
            }}
          >
            {item.label}
          </Pressable>
        ))}
      </div>
      <Command.List className="misty-search-list">
        {!hits.length && !waiting ? (
          <div className="misty-search-empty">
            {typed ? `Nothing matches “${query.text}”` : "Nothing here yet"}
          </div>
        ) : null}
        {groups.map(([heading, list]) => (
          <Command.Group key={heading} heading={heading}>
            {list.map((hit) => (
              <Command.Item
                key={hit.id}
                value={hit.id}
                className="misty-search-item"
                data-two-lines={hit.excerpt?.length ? "true" : undefined}
                data-running={running === hit.id ? "true" : undefined}
                onSelect={() => void run(hit)}
              >
                <span className="misty-search-icon">{hit.icon}</span>
                <span className="misty-search-text">
                  <span className="misty-search-title">
                    {typed ? <Marked parts={markParts(hit.title, query.text)} /> : hit.title}
                  </span>
                  {hit.excerpt?.length ? (
                    <span className="misty-search-excerpt">
                      <Marked parts={hit.excerpt} />
                    </span>
                  ) : null}
                </span>
                {hit.shortcutId ? (
                  <ShortcutText commandId={hit.shortcutId} className="misty-search-detail" />
                ) : hit.detail || hit.updatedAt ? (
                  <span className="misty-search-detail">
                    {[hit.detail, hit.updatedAt ? shortAgo(hit.updatedAt) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
        {waiting ? (
          <div className="misty-search-skeletons" aria-hidden>
            {Array.from({ length: hits.length ? 2 : 4 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        ) : null}
      </Command.List>
      {error ? (
        <div className="misty-search-error" role="alert">
          {error}
        </div>
      ) : null}
      <footer className="misty-search-foot" aria-hidden>
        <span>
          Close <kbd>Esc</kbd>
        </span>
        <span>
          Change type <kbd>←</kbd>
          <kbd>→</kbd>
        </span>
        {primary ? (
          <span className="ml-auto">
            {primary.id === "action:ask" ? "Ask" : "Do it"} <kbd>⌘</kbd>
            <kbd>↵</kbd>
          </span>
        ) : null}
        <span className={primary ? undefined : "ml-auto"}>
          Open <kbd>↵</kbd>
        </span>
      </footer>
    </Command>
  );
}
