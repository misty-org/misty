import type { MailAccount } from "@/api/mail";
import { cn, Input, Spinner } from "@/shared/ui";
import { MailOpen, Menu, Paperclip, PenLine, RefreshCw, Search, Star, X } from "lucide-react";
import { useMemo, useState, type Ref } from "react";
import { decodeHtmlEntities, type InboxThread } from "../model";

type Filter = "all" | "unread" | "starred" | "attachments";

export function MobileInboxThreadList(props: {
  accounts: MailAccount[];
  threads: InboxThread[];
  totalCount: number;
  selectedKey: string;
  query?: string;
  searchInputRef?: Ref<HTMLInputElement>;
  loading: boolean;
  loadingMore: boolean;
  canLoadMore: boolean;
  onSearch: (query: string) => void;
  onOpen: (thread: InboxThread) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onCompose: () => void;
  onOpenNavigation: () => void;
  onAction: (
    thread: InboxThread,
    action: { read?: boolean; archived?: boolean; starred?: boolean },
  ) => void;
}) {
  const [query, setQuery] = useState(props.query ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const accountByConnection = useMemo(
    () => new Map(props.accounts.map((account) => [account.connection_id, account])),
    [props.accounts],
  );
  const visible = useMemo(
    () =>
      props.threads.filter((thread) => {
        if (filter === "unread" && !thread.unread) return false;
        if (filter === "starred" && !thread.starred) return false;
        if (
          filter === "attachments" &&
          !thread.messages.some((message) => message.attachments.length)
        )
          return false;
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return true;
        return `${thread.subject} ${thread.snippet} ${thread.participants
          .map((participant) => `${participant.name ?? ""} ${participant.email}`)
          .join(" ")}`
          .toLocaleLowerCase()
          .includes(needle);
      }),
    [filter, props.threads, query],
  );

  const submitSearch = () => props.onSearch(query.trim());

  return (
    <section className="flex h-full min-h-0 flex-col bg-charcoal-bg" aria-label="Inbox messages">
      <div className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px_44px] items-center gap-1 border-b border-charcoal-border px-2 py-2">
        <MobileAction label="Mailboxes" onPress={props.onOpenNavigation}>
          <Menu size={19} aria-hidden="true" />
        </MobileAction>
        <form
          className="relative min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cream-muted"
            aria-hidden="true"
          />
          <Input
            ref={props.searchInputRef}
            aria-label="Search mail"
            className="h-11 w-full bg-charcoal-card pl-9 pr-9 text-base"
            placeholder="Search mail"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={submitSearch}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-0 top-0 grid size-11 place-items-center text-cream-muted"
              onClick={() => {
                setQuery("");
                props.onSearch("");
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </form>
        <MobileAction label="Refresh Inbox" onPress={props.onRefresh} disabled={props.loading}>
          <RefreshCw size={18} className={cn(props.loading && "animate-spin")} aria-hidden="true" />
        </MobileAction>
        <MobileAction label="Compose email" onPress={props.onCompose}>
          <PenLine size={19} aria-hidden="true" />
        </MobileAction>
      </div>

      <div className="flex min-h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-charcoal-border px-3 py-1.5">
        {(["all", "unread", "starred", "attachments"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={cn(
              "min-h-9 shrink-0 rounded-full px-3 text-sm capitalize text-cream-muted",
              filter === value && "bg-charcoal-active text-cream-bright",
            )}
            onClick={() => setFilter(value)}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {props.loading && !props.threads.length ? (
          <div className="grid min-h-56 place-items-center text-cream-muted">
            <Spinner className="size-5" aria-label="Loading Inbox" />
          </div>
        ) : visible.length ? (
          <ul className="m-0 list-none p-0">
            {visible.map((thread) => (
              <MobileThreadRow
                key={thread.key}
                thread={thread}
                account={accountByConnection.get(thread.connectionId)}
                active={thread.key === props.selectedKey}
                onOpen={props.onOpen}
                onAction={props.onAction}
              />
            ))}
          </ul>
        ) : (
          <div className="grid min-h-56 place-items-center px-8 text-center">
            <div>
              <MailOpen className="mx-auto mb-3 text-cream-muted" size={24} aria-hidden="true" />
              <h2 className="text-base font-medium text-cream-bright">No messages here</h2>
              <p className="mt-1 text-sm leading-5 text-cream-muted">
                Try another mailbox, filter, or search.
              </p>
            </div>
          </div>
        )}
        {props.canLoadMore ? (
          <button
            type="button"
            className="mx-auto my-4 flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium text-cream-bright active:bg-charcoal-card"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? <Spinner className="size-4" /> : null}
            Load more
          </button>
        ) : null}
      </div>
      <p className="shrink-0 border-t border-charcoal-border px-4 py-2 text-center text-xs tabular-nums text-cream-muted">
        {props.totalCount} {props.totalCount === 1 ? "message" : "messages"}
      </p>
    </section>
  );
}

function MobileThreadRow(props: {
  thread: InboxThread;
  account?: MailAccount;
  active: boolean;
  onOpen: (thread: InboxThread) => void;
  onAction: (
    thread: InboxThread,
    action: { read?: boolean; archived?: boolean; starred?: boolean },
  ) => void;
}) {
  const { thread } = props;
  const sender =
    thread.participants.find(
      (participant) => participant.email.toLowerCase() !== props.account?.email.toLowerCase(),
    ) ?? thread.participants[0];
  const hasAttachments = thread.messages.some((message) => message.attachments.length);

  return (
    <li
      className={cn(
        "grid min-h-[76px] grid-cols-[minmax(0,1fr)_44px] border-b border-charcoal-border",
        thread.unread ? "bg-charcoal-bg" : "bg-charcoal-workspace",
        props.active && "bg-charcoal-card",
      )}
    >
      <button
        type="button"
        className="min-w-0 px-4 py-3 text-left active:bg-charcoal-card"
        onClick={() => props.onOpen(thread)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {thread.unread ? (
            <span
              className="size-2 shrink-0 rounded-full bg-notification-red"
              aria-label="Unread"
            />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm text-cream-muted",
              thread.unread && "font-semibold text-cream-bright",
            )}
          >
            {sender?.name || sender?.email || "Unknown sender"}
          </span>
          <time className="shrink-0 text-xs tabular-nums text-cream-muted">
            {formatMobileDate(thread.last_message_at)}
          </time>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          {hasAttachments ? (
            <Paperclip size={14} className="shrink-0 text-cream-muted" aria-label="Attachments" />
          ) : null}
          <span className="truncate text-[15px] font-medium text-cream-bright">
            {decodeHtmlEntities(thread.subject || "No subject")}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-cream-muted">
          {decodeHtmlEntities(thread.snippet)}
        </span>
      </button>
      <button
        type="button"
        aria-label={thread.starred ? "Unstar message" : "Star message"}
        className="grid size-11 place-items-center self-center rounded-lg text-cream-muted active:bg-charcoal-active active:text-cream-bright"
        onClick={() => props.onAction(thread, { starred: !thread.starred })}
      >
        <Star
          size={18}
          className={thread.starred ? "fill-sage-fg text-sage-fg" : undefined}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function MobileAction(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      className="grid size-11 place-items-center rounded-lg text-cream-muted active:bg-charcoal-card active:text-cream-bright disabled:opacity-50"
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}

function formatMobileDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
