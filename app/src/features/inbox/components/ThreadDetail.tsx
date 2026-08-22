import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  Toolbar,
  ToolbarGroup,
} from "@/shared/ui";
import {
  Archive,
  ArrowLeft,
  Mail,
  MailOpen,
  MoreVertical,
  Paperclip,
  Reply,
  Star,
} from "lucide-react";
import { AiSurfaceButton } from "@/features/ai-surface/AiPaneHost";
import { formatAddress, type InboxThread } from "../model";
import { EmailBody } from "./EmailBody";

export function ThreadDetail(props: {
  thread: InboxThread | null;
  loading: boolean;
  actioning: boolean;
  onAction: (action: { read?: boolean; archived?: boolean; starred?: boolean }) => void;
  onReply: () => void;
  onBack: () => void;
}) {
  if (!props.thread) {
    return (
      <section className="grid min-h-0 place-items-center bg-charcoal-bg p-8 max-[1100px]:hidden">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-charcoal-card">
            <Mail className="size-5 text-cream-faint" strokeWidth={1.5} />
          </div>
          <p className="m-0 text-sm font-medium text-cream-muted">No email selected</p>
          <p className="mt-1 text-xs text-cream-faint">Choose a message to read it here.</p>
        </div>
      </section>
    );
  }

  const thread = props.thread;
  return (
    <section className="flex h-full min-h-0 flex-col bg-charcoal-bg">
      <Toolbar label="Message actions" className="h-14 shrink-0 px-4">
        <ToolbarGroup>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to inbox"
            onClick={props.onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="mx-1 h-5 w-px bg-charcoal-border" aria-hidden="true" />
          <Action
            label="Archive"
            onClick={() => props.onAction({ archived: true })}
            disabled={props.actioning}
          >
            <Archive />
          </Action>
          <Action
            label={thread.unread ? "Mark read" : "Mark unread"}
            onClick={() => props.onAction({ read: thread.unread })}
            disabled={props.actioning}
          >
            {thread.unread ? <MailOpen /> : <Mail />}
          </Action>
        </ToolbarGroup>
        <ToolbarGroup align="end">
          <AiSurfaceButton />
          <Action
            label={thread.starred ? "Unstar" : "Star"}
            onClick={() => props.onAction({ starred: !thread.starred })}
            disabled={props.actioning}
          >
            <Star className={thread.starred ? "fill-sage-fg text-sage-fg" : ""} />
          </Action>
          <MessageMenu thread={thread} actioning={props.actioning} onAction={props.onAction} />
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-6 lg:px-8">
          <div className="mb-6 flex items-start gap-4">
            <h2 className="m-0 min-w-0 flex-1 text-xl font-semibold leading-tight tracking-[-0.02em] text-cream-bright">
              {thread.subject}
            </h2>
            <Action
              label={thread.starred ? "Unstar" : "Star"}
              onClick={() => props.onAction({ starred: !thread.starred })}
              disabled={props.actioning}
            >
              <Star className={thread.starred ? "fill-sage-fg text-sage-fg" : ""} />
            </Action>
          </div>

          {props.loading && !thread.messages.length ? (
            <Spinner className="mx-auto my-10 size-5" />
          ) : null}
          {thread.messages.map((message) => {
            const sender = formatAddress(message.from);
            return (
              <article
                key={message.provider_id}
                className="border-b border-charcoal-border py-5 first:pt-0 last:border-b-0"
                data-email-message={message.provider_id}
              >
                <div className="flex items-start gap-3">
                  <Avatar size="lg" className="border-0">
                    <AvatarFallback className="bg-agent-indigo text-avatar-ink">
                      {sender.slice(0, 1).toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-sm font-semibold text-cream-bright">{sender}</p>
                      {message.from.name ? (
                        <p className="truncate text-[11px] text-cream-faint">
                          &lt;{message.from.email}&gt;
                        </p>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-cream-faint">
                      to {message.to.map(formatAddress).join(", ") || "me"}
                    </p>
                  </div>
                  <time className="whitespace-nowrap text-[10px] tabular-nums text-cream-faint">
                    {formatMessageDate(message.sent_at)}
                  </time>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Reply"
                    onClick={props.onReply}
                  >
                    <Reply className="size-3.5" />
                  </Button>
                </div>

                <EmailBody body={message.body} snippet={message.snippet} />

                {message.attachments.length ? (
                  <div className="ml-[52px] mt-5 flex flex-wrap gap-2">
                    {message.attachments.map((attachment) => (
                      <span
                        key={attachment.provider_id}
                        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-charcoal-border px-2.5 text-xs text-cream-muted"
                      >
                        <Paperclip className="size-3.5" />
                        <span className="truncate">{attachment.filename}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}

          {thread.messages.length ? (
            <div className="flex gap-2 pt-6">
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-4"
                onClick={props.onReply}
              >
                <Reply className="size-4" /> Reply
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Action(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="[&>svg]:size-4">{props.children}</span>
    </Button>
  );
}

function MessageMenu(props: {
  thread: InboxThread;
  actioning: boolean;
  onAction: (action: { read?: boolean; archived?: boolean; starred?: boolean }) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="More message actions"
          title="More message actions"
          disabled={props.actioning}
        >
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => props.onAction({ read: props.thread.unread })}>
          {props.thread.unread ? <MailOpen /> : <Mail />}
          {props.thread.unread ? "Mark as read" : "Mark as unread"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => props.onAction({ starred: !props.thread.starred })}>
          <Star />
          {props.thread.starred ? "Remove star" : "Add star"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => props.onAction({ archived: true })}>
          <Archive />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatMessageDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
