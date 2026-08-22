import type { MailAccount } from "@/api/mail";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  MoreVertical,
  RefreshCw,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatAddress, type InboxThread } from "../model";

export function ThreadList(props: {
  accounts: MailAccount[];
  threads: InboxThread[];
  totalCount: number;
  selectedKey: string;
  loading: boolean;
  loadingMore: boolean;
  canLoadMore: boolean;
  onOpen: (thread: InboxThread) => void;
  onPrefetch?: (thread: InboxThread) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onAction: (
    thread: InboxThread,
    action: { read?: boolean; archived?: boolean; starred?: boolean },
  ) => void;
}) {
  const onPrefetch = props.onPrefetch;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const accountByConnection = useMemo(
    () => new Map(props.accounts.map((account) => [account.connection_id, account])),
    [props.accounts],
  );

  useEffect(() => {
    const available = new Set(props.threads.map((thread) => thread.key));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
    if (onPrefetch && props.threads.length) {
      props.threads.slice(0, 15).forEach((thread) => {
        onPrefetch(thread);
      });
    }
  }, [onPrefetch, props.threads]);

  const allSelected = Boolean(props.threads.length) && selectedKeys.size === props.threads.length;
  const selectedThreads = props.threads.filter((thread) => selectedKeys.has(thread.key));
  const toggleAll = () =>
    setSelectedKeys(allSelected ? new Set() : new Set(props.threads.map((thread) => thread.key)));
  const bulkAction = (action: { read?: boolean; archived?: boolean }) => {
    selectedThreads.forEach((thread) => props.onAction(thread, action));
    setSelectedKeys(new Set());
  };
  const selectThreads = (predicate: (thread: InboxThread) => boolean) =>
    setSelectedKeys(new Set(props.threads.filter(predicate).map((thread) => thread.key)));
  const actOnVisible = (predicate: (thread: InboxThread) => boolean, action: { read: boolean }) =>
    props.threads.filter(predicate).forEach((thread) => props.onAction(thread, action));
  const rangeLabel = props.threads.length
    ? `1–${props.threads.length} of ${Math.max(props.totalCount, props.threads.length)}`
    : "0 of 0";

  return (
    <section className="flex h-full min-h-0 flex-col bg-charcoal-workspace">
      <Toolbar label="Inbox actions" className="h-14 shrink-0 px-4">
        <ToolbarGroup>
          <span className="grid size-8 place-items-center">
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
                className="-ml-2"
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
              >
                <RefreshCw className={cn("size-4", props.loading && "animate-spin")} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="More inbox actions"
                    title="More inbox actions"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onSelect={() => actOnVisible((thread) => thread.unread, { read: true })}
                  >
                    <MailOpen />
                    Mark all as read
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => actOnVisible((thread) => !thread.unread, { read: false })}
                  >
                    <Mail />
                    Mark all as unread
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => selectThreads(() => true)}>
                    Select all visible
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </ToolbarGroup>
        <ToolbarGroup align="end">
          <span className="mr-1 whitespace-nowrap text-[11px] tabular-nums text-cream-faint">
            {selectedKeys.size ? `${selectedKeys.size} selected` : rangeLabel}
          </span>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Previous page" disabled>
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Next page"
            disabled={!props.canLoadMore || props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? (
              <Spinner className="size-3.5" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.loading && !props.threads.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-cream-muted">
            <Spinner className="size-4" /> Loading mail…
          </div>
        ) : !props.threads.length ? (
          <div className="px-6 py-12 text-center">
            <p className="m-0 text-sm font-medium text-cream-muted">No messages here</p>
            <p className="mb-0 mt-1 text-xs text-cream-faint">This inbox is caught up.</p>
          </div>
        ) : (
          props.threads.map((thread) => {
            const selected = selectedKeys.has(thread.key);
            const account = accountByConnection.get(thread.connectionId);
            return (
              <div
                key={thread.key}
                role="button"
                tabIndex={0}
                aria-current={props.selectedKey === thread.key ? "true" : undefined}
                className={cn(
                  "group grid min-h-12 w-full cursor-pointer",
                  "grid-cols-[22px_28px_minmax(100px,0.34fr)_minmax(180px,1fr)_68px] items-center gap-x-2",
                  "border-b border-charcoal-border/60 px-4 py-2 text-left outline-none transition-colors",
                  "hover:bg-charcoal-card/70 focus-visible:bg-charcoal-card",
                  thread.unread ? "bg-charcoal-bg" : "bg-charcoal-workspace",
                  props.selectedKey === thread.key && "bg-charcoal-card",
                )}
                data-email-thread={thread.key}
                onPointerEnter={() => props.onPrefetch?.(thread)}
                onFocus={() => props.onPrefetch?.(thread)}
                onClick={() => props.onOpen(thread)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onOpen(thread);
                  }
                }}
              >
                <span
                  className="grid place-items-center"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={selected ? "Deselect message" : "Select message"}
                    checked={selected}
                    onCheckedChange={(checked) =>
                      setSelectedKeys((current) => {
                        const next = new Set(current);
                        if (checked) next.add(thread.key);
                        else next.delete(thread.key);
                        return next;
                      })
                    }
                  />
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="text-cream-faint hover:text-cream"
                  aria-label={thread.starred ? "Unstar message" : "Star message"}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onAction(thread, { starred: !thread.starred });
                  }}
                >
                  <Star className={cn("size-4", thread.starred && "fill-sage-fg text-sage-fg")} />
                </Button>
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-2 truncate text-xs text-cream-muted",
                    thread.unread && "font-semibold text-cream-bright",
                  )}
                >
                  <ProviderDot provider={account?.provider ?? thread.provider} />
                  <span className="truncate">
                    {thread.participants.map(formatAddress).join(", ") || "Unknown sender"}
                  </span>
                </span>
                <span className="min-w-0 truncate text-xs">
                  <span
                    className={cn(
                      "text-cream-muted",
                      thread.unread && "font-semibold text-cream-bright",
                    )}
                  >
                    {thread.subject}
                  </span>
                  {thread.snippet ? (
                    <span className="text-cream-faint"> — {thread.snippet}</span>
                  ) : null}
                </span>
                <time
                  className={cn(
                    "justify-self-end whitespace-nowrap text-[10px] tabular-nums text-cream-faint",
                    thread.unread && "font-medium text-cream-muted",
                  )}
                >
                  {formatThreadDate(thread.last_message_at)}
                </time>
              </div>
            );
          })
        )}
        {props.canLoadMore ? (
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

function ProviderDot({ provider }: { provider: string }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        provider === "google" ? "bg-[#EA4335]" : "bg-[#4c9ee8]",
      )}
      aria-hidden="true"
    />
  );
}

function formatThreadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
