import type { MailAccount } from "@/api/mail";
import { Button, Checkbox, cn } from "@/shared/ui";
import { Archive, Mail, MailOpen, Paperclip, Star, Trash2 } from "lucide-react";
import { decodeHtmlEntities, type InboxThread } from "../model";

export function ThreadRow(props: {
  thread: InboxThread;
  selected: boolean;
  active: boolean;
  account?: MailAccount;
  onSelect: (checked: boolean) => void;
  onOpen: (thread: InboxThread) => void;
  onAction: (
    thread: InboxThread,
    action: { read?: boolean; archived?: boolean; starred?: boolean },
  ) => void;
}) {
  const { thread, selected, active, account, onSelect, onOpen, onAction } = props;
  const hasAttachments = thread.messages.some((m) => m.attachments?.length > 0);
  const messageCount = thread.messages.length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative grid min-h-12 w-full cursor-pointer",
        "grid-cols-[22px_28px_minmax(110px,0.28fr)_minmax(180px,1fr)_120px] items-center gap-x-2",
        "border-b border-charcoal-border/60 px-4 py-2 text-left outline-none transition-colors",
        "hover:bg-charcoal-card/70 focus-visible:bg-charcoal-card",
        thread.unread ? "bg-charcoal-bg" : "bg-charcoal-workspace",
        active && "bg-charcoal-card",
      )}
      data-email-thread={thread.key}
      onClick={() => onOpen(thread)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(thread);
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
          onCheckedChange={(checked) => onSelect(Boolean(checked))}
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
          onAction(thread, { starred: !thread.starred });
        }}
      >
        <Star className={cn("size-4", thread.starred && "fill-sage-fg text-sage-fg")} />
      </Button>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 truncate text-xs text-cream-muted",
          thread.unread && "font-semibold text-cream-bright",
        )}
      >
        <ProviderDot provider={account?.provider ?? thread.provider} />
        <span className="truncate">{formatThreadSenders(thread, account?.email)}</span>
        {messageCount > 1 ? (
          <span className="shrink-0 text-[10px] font-semibold text-cream-faint">
            {messageCount}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-xs">
        {hasAttachments ? (
          <Paperclip className="size-3.5 shrink-0 text-cream-faint" aria-label="Has attachments" />
        ) : null}
        <span
          className={cn(
            "truncate text-cream-muted",
            thread.unread && "font-semibold text-cream-bright",
          )}
        >
          {thread.subject}
        </span>
        {thread.snippet ? (
          <span className="truncate text-cream-faint"> — {thread.snippet}</span>
        ) : null}
      </span>

      <div className="relative flex h-full items-center justify-self-end">
        <time
          className={cn(
            "whitespace-nowrap text-[10px] tabular-nums text-cream-faint transition-opacity group-hover:opacity-0",
            thread.unread && "font-medium text-cream-muted",
          )}
        >
          {formatThreadDate(thread.last_message_at)}
        </time>
        <div
          className={cn(
            "absolute right-0 flex items-center gap-0.5 rounded-md bg-charcoal-card/95",
            "px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100",
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-cream-faint hover:text-cream"
            aria-label={thread.starred ? "Unstar message" : "Star message"}
            title={thread.starred ? "Unstar" : "Star"}
            onClick={() => onAction(thread, { starred: !thread.starred })}
          >
            <Star className={cn("size-3.5", thread.starred && "fill-sage-fg text-sage-fg")} />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-cream-faint hover:text-cream"
            aria-label="Archive message"
            title="Archive"
            onClick={() => onAction(thread, { archived: true })}
          >
            <Archive className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-cream-faint hover:text-cream"
            aria-label={thread.unread ? "Mark as read" : "Mark as unread"}
            title={thread.unread ? "Mark read" : "Mark unread"}
            onClick={() => onAction(thread, { read: thread.unread })}
          >
            {thread.unread ? <MailOpen className="size-3.5" /> : <Mail className="size-3.5" />}
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-cream-faint hover:text-cream"
            aria-label="Delete message"
            title="Delete"
            onClick={() => onAction(thread, { archived: true })}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
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

function formatThreadSenders(thread: InboxThread, accountEmail?: string): string {
  const selfEmail = accountEmail?.toLowerCase().trim();

  // If messages are available, derive directly from From and Cc
  if (thread.messages && thread.messages.length > 0) {
    const fromAddresses = thread.messages
      .map((m) => m.from)
      .filter((addr) => Boolean(addr && (addr.name || addr.email)));
    const ccAddresses = thread.messages.flatMap((m) => m.cc ?? []);

    const nonSelfFrom = selfEmail
      ? fromAddresses.filter((a) => a.email?.toLowerCase().trim() !== selfEmail)
      : fromAddresses;

    const chosenFrom = nonSelfFrom.length > 0 ? nonSelfFrom : fromAddresses;
    const chosenCc = selfEmail
      ? ccAddresses.filter((a) => a.email?.toLowerCase().trim() !== selfEmail)
      : ccAddresses;

    const sendersAndCc = [...chosenFrom, ...chosenCc];
    const names = Array.from(
      new Set(
        sendersAndCc
          .map((p) => decodeHtmlEntities(p.name?.trim() || p.email?.split("@")[0] || p.email))
          .filter(Boolean),
      ),
    );

    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    if (names.length > 2) return `${names[0]}, ${names[1]} +${names.length - 2}`;
  }

  // Otherwise use thread.participants
  if (thread.participants && thread.participants.length > 0) {
    const nonSelf = selfEmail
      ? thread.participants.filter((p) => p.email?.toLowerCase().trim() !== selfEmail)
      : thread.participants;
    const target = nonSelf.length > 0 ? nonSelf : thread.participants;

    const names = Array.from(
      new Set(
        target
          .map((p) => decodeHtmlEntities(p.name?.trim() || p.email?.split("@")[0] || p.email))
          .filter(Boolean),
      ),
    );

    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    if (names.length > 2) return `${names[0]}, ${names[1]} +${names.length - 2}`;
  }

  return "Unknown sender";
}

function formatThreadDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.valueOf() <= 0) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
