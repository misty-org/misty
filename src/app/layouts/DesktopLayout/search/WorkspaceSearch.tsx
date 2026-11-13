import { TourInfoButton } from "@/features/onboarding";
import { Command } from "cmdk";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { shortAgo, usePersonalAgentsStore } from "@/features/agents";
import type { WorkspaceView } from "@/features/app-windows";
import { ShortcutText, useShortcutHandler } from "@/features/shortcuts";
import {
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteMatch,
  CommandPaletteTab,
  Dialog,
  DialogContent,
  DialogTitle,
  cn,
  Kbd,
  OverflowFadeText,
  Separator,
  Skeleton,
  Text,
} from "@/shared/ui";
import { markSlotClass } from "../styles";
import { openNewChat, openWorkspaceRoute } from "../spaceNavigation";
import { markParts, type Part } from "./searchRank";
import { readQuery } from "./searchQuery";
import { useSearchDialog, useSearchUses } from "./searchStore";
import { searchKinds, type SearchHit, type SearchKind } from "./searchTypes";
import { useSearchHits } from "./useSearchHits";
import { useNow } from "@/shared/hooks/useNow";

/**
 * ⌘K search: one box for everything in Misty. It finds chats (by what was said in them too),
 * agents, the Space's docs, messages, tasks, events and files, Tutor's notebooks and lessons,
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
        className="max-w-170 gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        {open ? <SearchBody onOpen={onOpen} close={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** One of the foot's key hints, in the muted text. */
function Hint(props: { className?: string; children: ReactNode }) {
  return (
    <Text bare tone="muted" className={props.className}>
      {props.children}
    </Text>
  );
}

function Marked({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.marked ? (
          <CommandPaletteMatch key={index}>{part.text}</CommandPaletteMatch>
        ) : (
          <span key={index}>{part.text}</span>
        ),
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
  const now = useNow();
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
      // Search: an input, the type row, the list and a foot of key hints, in one rounded panel.
      className="flex max-h-[min(560px,calc(100dvh_-_8rem))] flex-col"
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
      <CommandPaletteInput
        data-tour="search-input"
        className="misty-search-input pt-5 pr-14 pb-2.5 pl-5"
        placeholder={searchKinds.find((item) => item.id === kind)?.placeholder ?? "Search"}
        value={raw}
        onValueChange={(value) => {
          setRaw(value);
          setError("");
        }}
        autoFocus
      />
      <div
        className="flex gap-0.5 px-3.5 pt-1 pb-3"
        role="tablist"
        aria-label="Type"
        data-tour="search-kinds"
      >
        {searchKinds.map((item) => (
          <CommandPaletteTab
            key={item.id}
            aria-selected={kind === item.id}
            onClick={() => {
              setPicked(item.id);
              // A tab replaces a prefix that chose another.
              if (query.kind && query.kind !== item.id) setRaw(query.text);
            }}
          >
            {item.label}
          </CommandPaletteTab>
        ))}
      </div>
      <Separator />
      <CommandPaletteList className="min-h-0 flex-auto px-2 pt-1.5 pb-2" data-tour="search-list">
        {!hits.length && !waiting ? (
          <Text
            wrap
            as="div"
            size="meta"
            tone="muted"
            className="px-3 py-7 text-center leading-(--text-body--line-height)"
          >
            {typed ? `Nothing matches “${query.text}”` : "Nothing here yet"}
          </Text>
        ) : null}
        {groups.map(([heading, list]) => (
          <Command.Group key={heading} heading={heading}>
            {list.map((hit) => (
              <CommandPaletteItem
                key={hit.id}
                value={hit.id}
                className={cn("misty-search-item", running === hit.id && "opacity-60")}
                twoLines={Boolean(hit.excerpt?.length)}
                data-running={running === hit.id ? "true" : undefined}
                onSelect={() => void run(hit)}
              >
                <Text
                  bare
                  tone="muted"
                  className={cn(markSlotClass, "[&>span]:text-control [&>span]:leading-none")}
                >
                  {hit.icon}
                </Text>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OverflowFadeText className="misty-search-title">
                    {typed ? <Marked parts={markParts(hit.title, query.text)} /> : hit.title}
                  </OverflowFadeText>
                  {hit.excerpt?.length ? (
                    // The words around the match, under the title.
                    <Text
                      size="caption"
                      tone="muted"
                      className="misty-search-excerpt leading-(--text-body--line-height)"
                    >
                      <Marked parts={hit.excerpt} />
                    </Text>
                  ) : null}
                </span>
                {hit.shortcutId ? (
                  <Text bare tone="muted" className="contents">
                    <ShortcutText commandId={hit.shortcutId} className="flex-none text-caption" />
                  </Text>
                ) : hit.detail || hit.updatedAt ? (
                  <Text bare tone="muted" className="flex-none text-caption">
                    {[hit.detail, hit.updatedAt ? shortAgo(hit.updatedAt, now) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </CommandPaletteItem>
            ))}
          </Command.Group>
        ))}
        {waiting ? (
          <div className="flex flex-col gap-3.5 px-3 py-4" aria-hidden>
            {Array.from({ length: hits.length ? 2 : 4 }, (_, index) => (
              <Skeleton key={index} className={cn("h-3", index % 2 ? "w-[42%]" : "w-[60%]")} />
            ))}
          </div>
        ) : null}
      </CommandPaletteList>
      {error ? (
        <>
          <Separator />
          <Text
            wrap
            as="div"
            size="caption"
            tone="bright"
            role="alert"
            className="px-5 py-2 leading-(--text-body--line-height)"
          >
            {error}
          </Text>
        </>
      ) : null}
      <Separator />
      {/* The foot: its key hints, then the "i" for the search's tour at its end. */}
      <footer className="flex min-h-10 items-center gap-3 py-1 pr-3 pl-4">
        <div
          className="flex min-w-0 flex-1 items-center gap-5 text-caption leading-(--text-body--line-height)"
          aria-hidden
          data-tour="search-hints"
        >
          <Hint>
            Close{" "}
            <Kbd size="micro" className="ml-1">
              Esc
            </Kbd>
          </Hint>
          {/* What the box understands, said here rather than in its placeholder, until text is typed. */}
          {typed ? null : (
            <>
              <Hint>
                Agents{" "}
                <Kbd size="micro" className="ml-1">
                  @
                </Kbd>
              </Hint>
              <Hint>
                Commands{" "}
                <Kbd size="micro" className="ml-1">
                  /
                </Kbd>
              </Hint>
            </>
          )}
          <Hint>
            Change type{" "}
            <Kbd size="micro" className="ml-1">
              ←
            </Kbd>
            <Kbd size="micro" className="ml-0.5">
              →
            </Kbd>
          </Hint>
          {primary ? (
            <Hint className="ml-auto">
              {primary.id === "action:ask" ? "Ask" : "Do it"}{" "}
              <Kbd size="micro" className="ml-1">
                ⌘
              </Kbd>
              <Kbd size="micro" className="ml-0.5">
                ↵
              </Kbd>
            </Hint>
          ) : null}
          <Hint className={primary ? undefined : "ml-auto"}>
            Open{" "}
            <Kbd size="micro" className="ml-1">
              ↵
            </Kbd>
          </Hint>
        </div>
        <TourInfoButton tour="search" />
      </footer>
    </Command>
  );
}
