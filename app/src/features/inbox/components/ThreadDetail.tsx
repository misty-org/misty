import type { MailAccount, MailDraftInput } from "@/api/mail";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  Toolbar,
  ToolbarGroup,
} from "@/shared/ui";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  CheckSquare,
  Forward,
  Mail,
  MailOpen,
  MoreVertical,
  Paperclip,
  Reply,
  Star,
  Users,
} from "lucide-react";
import { useState } from "react";
import { formatAddress, type InboxThread, type ReplyMode } from "../model";
import { EmailBody } from "./EmailBody";
import { InlineQuickReply } from "./InlineQuickReply";

export function ThreadDetail(props: {
  thread: InboxThread | null;
  accounts?: MailAccount[];
  loading: boolean;
  actioning: boolean;
  onAction: (action: { read?: boolean; archived?: boolean; starred?: boolean }) => void;
  onReply: (mode?: ReplyMode) => void;
  onSendQuickReply?: (draft: MailDraftInput) => Promise<void>;
  onExpandToModal?: (draft: {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    text: string;
    mode: ReplyMode;
  }) => void;
  onConvertToTask?: (thread: InboxThread) => void;
  onClipToJournal?: (thread: InboxThread) => void;
  onSummarizeThread?: (thread: InboxThread) => void;
  onBack: () => void;
}) {
  const [replyMode, setReplyMode] = useState<ReplyMode>("reply");
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

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

  const handleGenerateSummary = async () => {
    if (summary) {
      setSummary(null);
      return;
    }
    setSummarizing(true);
    if (props.onSummarizeThread) {
      props.onSummarizeThread(thread);
    }
    // Generate an executive summary of thread messages
    const latestSnippet = thread.messages.map((m) => m.snippet || m.body.text).join(" ");
    const bullet1 = `• Subject: ${thread.subject}`;
    const bullet2 = `• From ${thread.participants.map(formatAddress).join(", ")}`;
    const bullet3 = `• Key points: ${latestSnippet.slice(0, 140)}…`;
    setTimeout(() => {
      setSummary(`${bullet1}\n${bullet2}\n${bullet3}`);
      setSummarizing(false);
    }, 300);
  };

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
          {/* Workspace Synergy Actions */}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="gap-1 text-xs text-cream-faint hover:text-cream"
            aria-label="Summarize with AI"
            title="Summarize with AI"
            onClick={handleGenerateSummary}
          >
            {summarizing ? (
              <Spinner className="size-3.5" />
            ) : (
              <BookOpen className="size-3.5 text-sage-fg" />
            )}
            <span className="hidden sm:inline">Summarize</span>
          </Button>

          {props.onConvertToTask ? (
            <Action
              label="Turn into Task"
              onClick={() => props.onConvertToTask?.(thread)}
              disabled={props.actioning}
            >
              <CheckSquare />
            </Action>
          ) : null}

          {props.onClipToJournal ? (
            <Action
              label="Clip to Journal"
              onClick={() => props.onClipToJournal?.(thread)}
              disabled={props.actioning}
            >
              <BookOpen />
            </Action>
          ) : null}

          <span className="mx-1 h-5 w-px bg-charcoal-border" aria-hidden="true" />

          <Action
            label={thread.starred ? "Unstar" : "Star"}
            onClick={() => props.onAction({ starred: !thread.starred })}
            disabled={props.actioning}
          >
            <Star className={thread.starred ? "fill-sage-fg text-sage-fg" : ""} />
          </Action>
          <MessageMenu
            thread={thread}
            actioning={props.actioning}
            onAction={props.onAction}
            onConvertToTask={props.onConvertToTask}
            onClipToJournal={props.onClipToJournal}
          />
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

          {/* AI Summary Card */}
          {summary ? (
            <div className="mb-6 rounded-lg border border-sage-fg/30 bg-sage-fg/5 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sage-fg">
                <BookOpen className="size-3.5" />
                AI Thread Summary
              </div>
              <pre className="m-0 whitespace-pre-wrap font-sans text-xs leading-relaxed text-cream-muted">
                {summary}
              </pre>
            </div>
          ) : null}

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
                      {message.cc?.length
                        ? ` (Cc: ${message.cc.map(formatAddress).join(", ")})`
                        : ""}
                    </p>
                  </div>
                  <time className="whitespace-nowrap text-[10px] tabular-nums text-cream-faint">
                    {formatMessageDate(message.sent_at)}
                  </time>
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Reply"
                      title="Reply"
                      onClick={() => {
                        setReplyMode("reply");
                        props.onReply("reply");
                      }}
                    >
                      <Reply className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Reply all"
                      title="Reply all"
                      onClick={() => {
                        setReplyMode("replyAll");
                        props.onReply("replyAll");
                      }}
                    >
                      <Users className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Forward"
                      title="Forward"
                      onClick={() => {
                        setReplyMode("forward");
                        props.onReply("forward");
                      }}
                    >
                      <Forward className="size-3.5" />
                    </Button>
                  </div>
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
                        <span className="text-[10px] text-cream-faint">
                          ({formatAttachmentSize(attachment.size)})
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}

          {/* Quick Action buttons / Inline Reply Area */}
          {thread.messages.length ? (
            <InlineQuickReply
              thread={thread}
              accounts={props.accounts ?? []}
              replyMode={replyMode}
              onReplyModeChange={setReplyMode}
              onExpandToModal={(draft) => {
                if (props.onExpandToModal) {
                  props.onExpandToModal(draft);
                } else {
                  props.onReply(draft.mode);
                }
              }}
              onSend={async (draft) => {
                if (props.onSendQuickReply) {
                  await props.onSendQuickReply(draft);
                }
              }}
            />
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
  onConvertToTask?: (thread: InboxThread) => void;
  onClipToJournal?: (thread: InboxThread) => void;
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
        {props.onConvertToTask || props.onClipToJournal ? <DropdownMenuSeparator /> : null}
        {props.onConvertToTask ? (
          <DropdownMenuItem onSelect={() => props.onConvertToTask?.(props.thread)}>
            <CheckSquare />
            Turn into Task
          </DropdownMenuItem>
        ) : null}
        {props.onClipToJournal ? (
          <DropdownMenuItem onSelect={() => props.onClipToJournal?.(props.thread)}>
            <BookOpen />
            Clip to Journal
          </DropdownMenuItem>
        ) : null}
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

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
