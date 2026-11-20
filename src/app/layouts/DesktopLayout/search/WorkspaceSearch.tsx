import { TourInfoButton } from "@/features/onboarding";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { shortAgo, usePersonalAgentsStore } from "@/features/agents";
import type { WorkspaceView } from "@/features/app-windows";
import { ShortcutText, useShortcutHandler } from "@/features/shortcuts";
import {
  Badge,
  CommandPalette,
  CommandPaletteGroup,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteMatch,
  Dialog,
  DialogContent,
  DialogTitle,
  cn,
  IconButton,
  Kbd,
  OverflowFadeText,
  Separator,
  Skeleton,
  Text,
} from "@misty/ui";
import { markSlotClass } from "../styles";
import { openNewChat, openWorkspaceRoute } from "../spaceNavigation";
import { markParts, type Part } from "./searchRank";
import { readQuery } from "./searchQuery";
import { useSearchDialog, useSearchUses } from "./searchStore";
import { searchKinds, type SearchHit, type SearchKind } from "./searchTypes";
import { useSearchHits } from "./useSearchHits";
import { useNow } from "@/shared/hooks/useNow";
import { useScopedSearch } from "@/shared/lib/scopedSearch";

/** What the rest of Misty is asked while a page scope narrows the box: nothing typed. */
const IDLE_QUERY = readQuery("", []);

/** The kind of thing the page in front of the person holds, whose hits rank first: chats on the
 * agents page, notebooks in the Lab, settings in Settings, the Space's things in a Space. */
function pageKind(path = ""): SearchKind | undefined {
  if (path.startsWith("/agents")) return "chats";
  if (path.startsWith("/settings")) return "settings";
  if (/^\/spaces\/[^/]+\/lab/.test(path)) return "learn";
  if (path.startsWith("/spaces/")) return "space";
  return undefined;
}

/**
 * ⌘K search: one box for everything in Misty. It finds chats (by what was said in them too),
 * agents, the Space's messages, notebooks and files, Tutor's lessons, apps to connect, settings,
 * commands and pages, and does what the text asks: `@agent …` asks an agent, ⌘↵ asks the usual
 * agent. With nothing typed it shows what was
 * opened last. A prefix narrows it to one kind (`/` commands, `#` the Space); there is no row of
 * types, and pages' own search fields only filter what the page shows. The page in front ranks
 * its own kind first, and a page can open it scoped to its items (⌘P on the Code page). Mounted
 * once per window, so ⌘K works with the sidebar hidden.
 */
export function WorkspaceSearch({
  onOpen,
  path,
}: {
  onOpen(view: WorkspaceView): void;
  /** The focused page's route, so its own things rank first. */
  path?: string;
}) {
  const open = useSearchDialog((state) => state.open);
  const setOpen = useSearchDialog((state) => state.setOpen);
  useShortcutHandler("app.command_palette", () => {
    const state = useSearchDialog.getState();
    state.setOpen(!state.open);
  });
  // A page asks for the box scoped to its own items (⌘P on the Code page).
  const scopeNonce = useScopedSearch((state) => state.nonce);
  useEffect(() => {
    const request = useScopedSearch.getState().request;
    if (scopeNonce && request) useSearchDialog.getState().openScoped(request);
  }, [scopeNonce]);
  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
      <DialogContent
        placement="top"
        className="max-w-170 gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        {open ? (
          <SearchBody onOpen={onOpen} here={pageKind(path)} close={() => setOpen(false)} />
        ) : null}
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

/** Puts hits under their headings, in the order of each heading's best hit. With nothing typed
 * the box shows a short list of what was opened last and no actions, which wait for words. */
function grouped(hits: SearchHit[], kind: SearchKind, typed: boolean) {
  const groups = new Map<string, SearchHit[]>();
  const cap = kind === "all" ? (typed ? 4 : 5) : 40;
  for (const hit of hits) {
    if (!typed && kind === "all" && hit.group === "Actions") continue;
    const heading =
      !typed && hit.group !== "Actions" && kind !== "commands" ? "Recents" : hit.group;
    const list = groups.get(heading) ?? [];
    if (list.length < (heading === "Actions" ? 6 : cap)) list.push(hit);
    groups.set(heading, list);
  }
  return [...groups];
}

function SearchBody({
  onOpen,
  here,
  close,
}: {
  onOpen(view: WorkspaceView): void;
  here?: SearchKind;
  close(): void;
}) {
  const now = useNow();
  const initial = useSearchDialog((state) => state.initial);
  const [raw, setRaw] = useState(initial);
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
  // A page's scope (⌘P: the Code page's files) searches only its items, under a chip; the rest of
  // Misty sits idle until Backspace on the empty field drops the chip.
  const scope = useSearchDialog((state) => state.scope);
  const [scopeVersion, setScopeVersion] = useState(0);
  useEffect(() => scope?.subscribe?.(() => setScopeVersion((version) => version + 1)), [scope]);
  const text = scope ? raw.trim() : query.text;
  const kind: SearchKind = scope ? "files" : (query.kind ?? "all");
  const typed = text.length > 0;
  const openRoute = useCallback((route: string) => openWorkspaceRoute(route, onOpen), [onOpen]);
  const onNewChat = useCallback(() => openNewChat(onOpen), [onOpen]);
  const everything = useSearchHits({
    query: scope ? IDLE_QUERY : query,
    kind: scope ? "all" : kind,
    here,
    openRoute,
    onNewChat,
  });
  const scopedHits = useMemo<SearchHit[] | null>(() => {
    if (!scope) return null;
    // Read again when the scope says its items changed (an index finished loading).
    void scopeVersion;
    return scope.search(text).map((hit, index) => ({
      id: `scope:${hit.id}`,
      kind: "files",
      group: scope.label,
      title: hit.title,
      detail: hit.detail,
      icon: hit.icon,
      match: 1000 - index,
      open: hit.open,
    }));
  }, [scope, scopeVersion, text]);
  const hits = scopedHits ?? everything.hits;
  const waiting = scopedHits ? false : everything.waiting;
  const groups = useMemo(
    () =>
      scope
        ? scopedHits?.length
          ? ([[scope.label, scopedHits]] as [string, SearchHit[]][])
          : []
        : grouped(hits, kind, typed),
    [scope, scopedHits, hits, kind, typed],
  );

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
    // Asking an agent takes a moment; the box stays until it is done.
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
  /** ⌘↵: what the text asks for, or asking the usual agent. A scoped box only opens items. */
  const primary = scope
    ? undefined
    : hits.find(
        (hit) =>
          hit.group === "Actions" &&
          hit.id.startsWith("action:") &&
          hit.id !== "action:new-chat" &&
          (hit.match >= 10 || hit.id === "action:ask"),
      );
  return (
    <CommandPalette
      // Search: an input, the list and a foot of hints, in one rounded panel. There is no row of
      // types: a prefix narrows the search (`/` commands, `#` the Space, `@` an agent).
      className="max-h-[min(35rem,calc(100dvh_-_8rem))]"
      shouldFilter={false}
      loop
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (primary) void run(primary);
        }
      }}
    >
      <div className="flex min-w-0 items-center">
        {scope ? (
          // The scope's chip; its × (or Backspace on the empty field) widens to everything.
          <span className="flex flex-none items-center gap-0.5 pt-1 pl-5">
            <Badge variant="outline">{scope.label}</Badge>
            <IconButton
              label="Search everything"
              onClick={() => useSearchDialog.getState().clearScope()}
            >
              <X />
            </IconButton>
          </span>
        ) : null}
        <CommandPaletteInput
          data-tour="search-input"
          className={cn("misty-search-input pt-5 pr-14 pb-4", scope ? "pl-2" : "pl-5")}
          placeholder={
            scope
              ? scope.placeholder
              : (searchKinds.find((item) => item.id === kind)?.placeholder ?? "Search")
          }
          value={raw}
          onValueChange={(value) => {
            setRaw(value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (scope && !raw && event.key === "Backspace") {
              event.preventDefault();
              useSearchDialog.getState().clearScope();
            }
          }}
          autoFocus
        />
      </div>
      <Separator />
      <CommandPaletteList className="min-h-0 flex-auto px-2 pt-1.5 pb-2" data-tour="search-list">
        {!hits.length && !waiting && (typed || !scope) ? (
          <Text
            wrap
            as="div"
            size="meta"
            tone="muted"
            className="px-3 py-7 text-center leading-(--text-body--line-height)"
          >
            {typed ? `Nothing matches “${text}”` : "Nothing here yet"}
          </Text>
        ) : null}
        {groups.map(([heading, list]) => (
          <CommandPaletteGroup key={heading} heading={heading}>
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
                    {typed ? <Marked parts={markParts(hit.title, text)} /> : hit.title}
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
          </CommandPaletteGroup>
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
      {/* The foot: only what the box understands that nobody would guess (Esc and ↵ go without
          saying), then the "i" for the search's tour at its end. */}
      <footer className="flex min-h-10 items-center gap-3 py-1 pr-3 pl-4">
        <div
          className="flex min-w-0 flex-1 items-center gap-5 text-caption leading-(--text-body--line-height)"
          aria-hidden
          data-tour="search-hints"
        >
          {/* The prefixes, said here rather than in the placeholder, until text is typed. */}
          {typed || query.kind || scope ? null : (
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
              <Hint>
                This Space{" "}
                <Kbd size="micro" className="ml-1">
                  #
                </Kbd>
              </Hint>
            </>
          )}
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
        </div>
        <TourInfoButton tour="search" />
      </footer>
    </CommandPalette>
  );
}
