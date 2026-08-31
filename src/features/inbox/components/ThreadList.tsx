import type { MailAccount } from "@/api/mail";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Spinner,
  Toolbar,
  ToolbarGroup,
  cn,
} from "@/shared/ui";
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type Ref } from "react";
import type { InboxThread } from "../model";
import { ThreadRow } from "./ThreadRow";

const PAGE_SIZE = 50;

function fuzzyMatchThread(thread: InboxThread, query: string): boolean {
  const cleanQuery = query.toLowerCase().trim();
  if (!cleanQuery) return true;

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const subject = thread.subject.toLowerCase();
  const snippet = thread.snippet.toLowerCase();
  const participants = thread.participants
    .map((p) => `${p.name ?? ""} ${p.email}`.toLowerCase())
    .join(" ");
  const messages = thread.messages
    .map((m) =>
      `${m.from?.name ?? ""} ${m.from?.email ?? ""} ${m.subject ?? ""} ${m.snippet ?? ""} ${m.body?.text ?? ""}`.toLowerCase(),
    )
    .join(" ");
  const labels = thread.labels.join(" ").toLowerCase();
  const combined = `${subject} ${snippet} ${participants} ${messages} ${labels}`;

  return tokens.every((token) => {
    if (combined.includes(token)) return true;
    return fuzzySubsequence(subject, token) || fuzzySubsequence(participants, token);
  });
}

function fuzzySubsequence(target: string, needle: string): boolean {
  if (needle.length <= 1) return target.includes(needle);
  let targetIndex = 0;
  for (let needleIndex = 0; needleIndex < needle.length; needleIndex++) {
    const char = needle[needleIndex];
    targetIndex = target.indexOf(char, targetIndex);
    if (targetIndex === -1) return false;
    targetIndex += 1;
  }
  return true;
}

export function ThreadList(props: {
  accounts: MailAccount[];
  threads: InboxThread[];
  totalCount: number;
  selectedKey: string;
  query?: string;
  searchInputRef?: Ref<HTMLInputElement>;
  loading: boolean;
  loadingMore: boolean;
  canLoadMore: boolean;
  onSearch?: (query: string) => void;
  onOpen: (thread: InboxThread) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onAction: (
    thread: InboxThread,
    action: { read?: boolean; archived?: boolean; starred?: boolean },
  ) => void;
}) {
  const onSearch = props.onSearch;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState(props.query ?? "");
  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "starred" | "attachments">(
    "all",
  );
  const [currentPage, setCurrentPage] = useState(0);

  const accountByConnection = useMemo(
    () => new Map(props.accounts.map((account) => [account.connection_id, account])),
    [props.accounts],
  );

  useEffect(() => {
    setSearchQuery(props.query ?? "");
  }, [props.query]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed === (props.query ?? "").trim()) return;

    const timer = setTimeout(() => {
      onSearch?.(trimmed);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, onSearch, props.query]);

  useEffect(() => {
    const available = new Set(props.threads.map((thread) => thread.key));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [props.threads]);

  const filteredThreads = useMemo(() => {
    let list = props.threads;
    if (searchQuery.trim()) {
      list = list.filter((t) => fuzzyMatchThread(t, searchQuery));
    }
    if (activeFilter === "unread") return list.filter((t) => t.unread);
    if (activeFilter === "starred") return list.filter((t) => t.starred);
    if (activeFilter === "attachments") {
      return list.filter((t) => t.messages.some((m) => m.attachments.length > 0));
    }
    return list;
  }, [activeFilter, props.threads, searchQuery]);

  const maxPage = Math.max(0, Math.ceil(filteredThreads.length / PAGE_SIZE) - 1);
  const safePage = Math.min(currentPage, maxPage);
  const startIndex = safePage * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredThreads.length);
  const paginatedThreads = filteredThreads.slice(startIndex, endIndex);

  const allSelected =
    Boolean(paginatedThreads.length) &&
    paginatedThreads.every((thread) => selectedKeys.has(thread.key));
  const selectedThreads = props.threads.filter((thread) => selectedKeys.has(thread.key));

  const toggleAll = () =>
    setSelectedKeys(
      allSelected ? new Set() : new Set(paginatedThreads.map((thread) => thread.key)),
    );

  const bulkAction = (action: { read?: boolean; archived?: boolean }) => {
    selectedThreads.forEach((thread) => props.onAction(thread, action));
    setSelectedKeys(new Set());
  };

  const selectThreads = (predicate: (thread: InboxThread) => boolean) =>
    setSelectedKeys(new Set(props.threads.filter(predicate).map((thread) => thread.key)));

  const actOnVisible = (predicate: (thread: InboxThread) => boolean, action: { read: boolean }) =>
    props.threads.filter(predicate).forEach((thread) => props.onAction(thread, action));

  const handleClearSearch = () => {
    setSearchQuery("");
    props.onSearch?.("");
  };

  const rangeLabel = filteredThreads.length
    ? `${startIndex + 1}–${endIndex} of ${Math.max(props.totalCount, filteredThreads.length)}`
    : "0 of 0";

  const handlePrevPage = () => {
    if (safePage > 0) setCurrentPage((p) => Math.max(0, p - 1));
  };

  const handleNextPage = () => {
    if (safePage < maxPage) {
      setCurrentPage((p) => p + 1);
    } else if (props.canLoadMore) {
      props.onLoadMore();
      setCurrentPage((p) => p + 1);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-charcoal-workspace">
      <Toolbar label="Inbox actions" className="h-14 shrink-0 gap-2 px-4">
        <ToolbarGroup>
          <span className="grid h-8 w-[22px] place-items-center">
            <Checkbox
              aria-label={allSelected ? "Clear message selection" : "Select all messages"}
              checked={allSelected ? true : selectedKeys.size ? "indeterminate" : false}
              onCheckedChange={toggleAll}
            />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Choose messages to select"
                title="Choose messages to select"
                className="-ml-1 text-cream-faint hover:text-cream"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => selectThreads(() => true)}>All</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSelectedKeys(new Set())}>None</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => selectThreads((thread) => !thread.unread)}>
                Read
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectThreads((thread) => thread.unread)}>
                Unread
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectThreads((thread) => thread.starred)}>
                Starred
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectThreads((thread) => !thread.starred)}>
                Unstarred
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedKeys.size ? (
            <>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Archive selected"
                title="Archive selected"
                onClick={() => bulkAction({ archived: true })}
                className="text-cream-faint hover:text-cream"
              >
                <Archive className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Mark selected read"
                title="Mark selected read"
                onClick={() => bulkAction({ read: true })}
                className="text-cream-faint hover:text-cream"
              >
                <MailOpen className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh inbox"
                title="Refresh inbox"
                disabled={props.loading}
                onClick={props.onRefresh}
                className="text-cream-faint hover:text-cream"
              >
                <RefreshCw className={cn("size-4", props.loading && "animate-spin")} />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Mark all as read"
                title="Mark all as read"
                onClick={() => actOnVisible((thread) => thread.unread, { read: true })}
                className="text-cream-faint hover:text-cream"
              >
                <MailOpen className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Mark all as unread"
                title="Mark all as unread"
                onClick={() => actOnVisible((thread) => !thread.unread, { read: false })}
                className="text-cream-faint hover:text-cream"
              >
                <Mail className="size-4" />
              </Button>
            </>
          )}
        </ToolbarGroup>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSearch?.(searchQuery.trim());
          }}
          className="relative mx-2 flex min-w-0 flex-1 max-w-sm items-center"
        >
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-cream-faint" />
          <Input
            ref={props.searchInputRef}
            type="text"
            aria-label="Search mail"
            placeholder="Search mail (e.g. from:, has:attachment)..."
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setCurrentPage(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.onSearch?.(searchQuery.trim());
              } else if (event.key === "Escape") {
                handleClearSearch();
              }
            }}
            className={cn(
              "h-8 w-full rounded-lg border-charcoal-border bg-charcoal-card",
              "pl-8 pr-7 text-xs text-cream placeholder:text-cream-faint/60 focus-visible:ring-1",
            )}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 grid size-4 place-items-center text-cream-faint hover:text-cream"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </form>

        <ToolbarGroup align="end">
          <span className="mr-1 whitespace-nowrap text-[11px] tabular-nums text-cream-faint">
            {selectedKeys.size ? `${selectedKeys.size} selected` : rangeLabel}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={handlePrevPage}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Next page"
            disabled={safePage >= maxPage && !props.canLoadMore}
            onClick={handleNextPage}
          >
            {props.loadingMore ? (
              <Spinner className="size-3.5" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <div className="flex items-center gap-1.5 border-b border-charcoal-border/50 bg-charcoal-workspace/60 px-4 py-1.5">
        <button
          type="button"
          data-filter-chip="all"
          onClick={() => {
            setActiveFilter("all");
            setCurrentPage(0);
          }}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            activeFilter === "all"
              ? "bg-charcoal-card text-cream-bright shadow-sm"
              : "text-cream-faint hover:bg-charcoal-card/50 hover:text-cream",
          )}
        >
          All
        </button>
        <button
          type="button"
          data-filter-chip="unread"
          onClick={() => {
            setActiveFilter("unread");
            setCurrentPage(0);
          }}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            activeFilter === "unread"
              ? "bg-charcoal-card text-cream-bright shadow-sm"
              : "text-cream-faint hover:bg-charcoal-card/50 hover:text-cream",
          )}
        >
          Unread
        </button>
        <button
          type="button"
          data-filter-chip="starred"
          onClick={() => {
            setActiveFilter("starred");
            setCurrentPage(0);
          }}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            activeFilter === "starred"
              ? "bg-charcoal-card text-cream-bright shadow-sm"
              : "text-cream-faint hover:bg-charcoal-card/50 hover:text-cream",
          )}
        >
          Starred
        </button>
        <button
          type="button"
          data-filter-chip="attachments"
          onClick={() => {
            setActiveFilter("attachments");
            setCurrentPage(0);
          }}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            activeFilter === "attachments"
              ? "bg-charcoal-card text-cream-bright shadow-sm"
              : "text-cream-faint hover:bg-charcoal-card/50 hover:text-cream",
          )}
        >
          Attachments
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.loading && !props.threads.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-cream-muted">
            <Spinner className="size-4" /> Loading mail…
          </div>
        ) : !paginatedThreads.length ? (
          <div className="px-6 py-12 text-center">
            <p className="m-0 text-sm font-medium text-cream-muted">No messages here</p>
            <p className="mb-0 mt-1 text-xs text-cream-faint">
              {activeFilter !== "all"
                ? `No ${activeFilter} messages found.`
                : "This inbox is caught up."}
            </p>
          </div>
        ) : (
          paginatedThreads.map((thread) => (
            <ThreadRow
              key={thread.key}
              thread={thread}
              selected={selectedKeys.has(thread.key)}
              active={props.selectedKey === thread.key}
              account={accountByConnection.get(thread.connectionId)}
              onSelect={(checked) =>
                setSelectedKeys((current) => {
                  const next = new Set(current);
                  if (checked) next.add(thread.key);
                  else next.delete(thread.key);
                  return next;
                })
              }
              onOpen={props.onOpen}
              onAction={props.onAction}
            />
          ))
        )}
        {props.canLoadMore && !paginatedThreads.length ? (
          <div className="p-3 text-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.loadingMore}
              onClick={props.onLoadMore}
            >
              {props.loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
