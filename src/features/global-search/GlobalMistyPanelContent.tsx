import { SystemErrorActivity } from "@/features/activity";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import {
  Bell,
  Bot,
  CalendarDays,
  Check,
  CheckSquare2,
  ChevronDown,
  File,
  Folder,
  FolderKanban,
  History,
  Library,
  Loader2,
  Map as MapIcon,
  MessageCircle,
  NotebookPen,
  Paintbrush,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import type {
  GlobalAiActionProposal,
  GlobalAiConversation,
  GlobalAiMode,
  GlobalSearchKind,
  GlobalSearchResult,
} from "./types";
import { MistyActivityStatus } from "./MistyActivityStatus";
import { MistyMessageAttachments } from "./MistyMessageAttachments";

export function SearchResults(props: {
  results: GlobalSearchResult[];
  query: string;
  searching: boolean;
  onOpen: (result: GlobalSearchResult) => void;
  onAddContext: (result: GlobalSearchResult) => void;
}) {
  if (!props.query.trim())
    return (
      <QuietState
        icon={Search}
        title="Search all of Misty"
        text="Files, Spaces, tasks, messages, agents, workflows, and more."
      />
    );
  if (!props.results.length && !props.searching)
    return (
      <QuietState icon={Search} title="No results" text={`Nothing matched “${props.query}”.`} />
    );
  return (
    <div className="p-2">
      <div className="flex h-7 items-center px-2 text-[11px] text-cream-muted">
        {props.searching ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : null}
        Showing {props.results.length} {props.results.length === 1 ? "result" : "results"}
      </div>
      {props.results.map((result) => {
        const Icon = resultIcons[result.kind];
        return (
          <div
            key={`${result.kind}:${result.id}`}
            className="group/result grid min-h-[58px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 hover:bg-charcoal-hover"
          >
            <button
              type="button"
              className="contents text-left"
              onClick={() => props.onOpen(result)}
            >
              <span className="grid size-9 place-items-center rounded-lg bg-charcoal-bg text-cream-muted">
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-medium text-cream">
                  {result.title}
                </span>
                <span className="block truncate text-xs text-cream-muted">
                  {result.body || result.spaceName || kindLabel(result.kind)}
                </span>
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 opacity-0 group-hover/result:opacity-100 focus:opacity-100"
              onClick={() => props.onAddContext(result)}
            >
              <Plus className="size-3.5" /> Context
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function ConversationView(props: {
  conversation?: GlobalAiConversation;
  working: boolean;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoFollowRef = useRef(true);
  const messages = props.conversation?.messages ?? [];
  const latestMessage = messages[messages.length - 1];

  useEffect(() => {
    const content = contentRef.current;
    const viewport = content?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const onScroll = () => {
      autoFollowRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 56;
    };
    onScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!autoFollowRef.current) return;
    const viewport = contentRef.current?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [latestMessage?.content, messages.length, props.working]);

  if (!props.conversation?.messages.length)
    return (
      <QuietState
        icon={MessageCircle}
        title="Start with Misty"
        text="Ask a grounded question or describe the action you want completed."
      />
    );
  return (
    <div ref={contentRef} className="space-y-3 p-3" data-misty-conversation-content>
      {props.conversation.messages.map((message) => (
        <article
          key={message.id}
          className={cn(
            "text-sm leading-relaxed",
            message.role === "user"
              ? "ml-auto w-fit max-w-[82%] rounded-xl border border-blue-300/15 bg-blue-500/15 px-3 py-2 text-blue-50"
              : "w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3.5 text-cream shadow-[0_12px_36px_rgba(0,0,0,0.14)]",
          )}
        >
          {message.role === "assistant" ? (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-cream-muted">
                <MessageCircle className="size-3" /> Misty
              </div>
              {message.content ? (
                <div className="misty-markdown-message">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <MistyActivityStatus activity={message.activity} compact />
              )}
            </>
          ) : (
            <>
              <MistyMessageAttachments attachments={message.attachments} />
              <p className="whitespace-pre-wrap">{message.content}</p>
            </>
          )}
          {message.citations?.length ? (
            <details className="group/sources mt-3 text-[11px] text-cream-muted">
              <summary
                className={cn(
                  "flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full border",
                  "border-white/10 bg-white/[0.025] px-2.5 py-1 hover:text-cream",
                )}
              >
                <Library className="size-3" />
                {message.citations.length} {message.citations.length === 1 ? "source" : "sources"}
                <ChevronDown className="size-3 transition-transform group-open/sources:rotate-180" />
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {message.citations.map((citation) => (
                  <Link
                    key={citation.id}
                    to={citation.href}
                    className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.025] px-2.5 py-1 hover:text-cream"
                  >
                    {citation.title}
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
          {message.action ? (
            <ActionProposal
              proposal={message.action}
              onConfirm={() => props.onConfirm(message.action!.id)}
              onReject={() => props.onReject(message.action!.id)}
              onCancel={() => props.onCancel?.(message.action!.id)}
            />
          ) : null}
        </article>
      ))}
      {props.working ? (
        <p className="px-1 text-[11px] text-cream-muted">Answering with your context…</p>
      ) : null}
    </div>
  );
}

function ActionProposal(props: {
  proposal: GlobalAiActionProposal;
  onConfirm: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const proposal = props.proposal;
  return (
    <div className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-xs text-cream-bright">{proposal.title}</strong>
        <span className="text-[10px] first-letter:uppercase text-cream-muted">{proposal.risk}</span>
      </div>
      {proposal.agentName ? (
        <p className="mt-1 text-[11px] text-cream-muted">
          Background work by {proposal.agentName}
          {proposal.spaceName ? ` in ${proposal.spaceName}` : ""}
        </p>
      ) : null}
      {proposal.error ? (
        <SystemErrorActivity
          error={proposal.error}
          scope={`misty:proposal:${proposal.id}`}
          title="Misty action could not be completed"
        />
      ) : null}
      {(proposal.state === "proposed" && proposal.requiresConfirmation) ||
      (proposal.state === "awaiting_approval" && proposal.approvalId) ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="h-7" onClick={props.onConfirm}>
            <Check className="size-3.5" /> Approve
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={props.onReject}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <p className="text-[11px] capitalize text-cream-muted">
            {proposal.state.replace("_", " ")}
          </p>
          {proposal.state === "running" || proposal.state === "awaiting_approval" ? (
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={props.onCancel}>
              Cancel
            </Button>
          ) : null}
          {proposal.resultHref ? (
            <Link
              className="text-[11px] text-cream-muted hover:text-cream"
              to={proposal.resultHref}
            >
              {proposal.resultHref.includes("/drawings/") ? "Open drawing" : "Open work log"}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ConversationMenu(props: {
  conversations: GlobalAiConversation[];
  activeId: string;
  loading?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const active = props.conversations.find((item) => item.id === props.activeId);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const visible = props.conversations
    .filter((item) => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, 12);
  const finishRename = () => {
    const title = draftTitle.trim();
    if (renamingId && title) props.onRename(renamingId, title);
    setRenamingId("");
    setDraftTitle("");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 max-w-48 gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] text-xs text-cream-muted hover:bg-white/[0.07] hover:text-cream"
        >
          <History className="size-3.5" />
          <span className="truncate">
            {active?.title ?? (props.loading ? "Loading…" : "New conversation")}
          </span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-misty-layer-portal>
        <DropdownMenuItem onSelect={props.onNew}>
          <Plus className="size-4" /> New conversation
        </DropdownMenuItem>
        {props.conversations.length ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Search className="size-3.5 text-cream-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="min-w-0 flex-1 bg-transparent text-xs text-cream outline-none placeholder:text-cream-muted"
              />
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {visible.map((conversation) => {
          const renaming = renamingId === conversation.id;
          return (
            <DropdownMenuItem
              key={conversation.id}
              onSelect={(event) => {
                if (renaming) event.preventDefault();
                else props.onSelect(conversation.id);
              }}
            >
              {renaming ? (
                <input
                  autoFocus
                  value={draftTitle}
                  aria-label={`Rename ${conversation.title}`}
                  className="h-7 min-w-0 flex-1 rounded-md border border-charcoal-border bg-charcoal-bg px-2 text-xs text-cream outline-none"
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishRename();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setRenamingId("");
                    }
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
              )}
              {renaming ? (
                <>
                  <button
                    type="button"
                    className="rounded p-1 text-cream-muted hover:text-cream"
                    aria-label={`Save ${conversation.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      finishRename();
                    }}
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-cream-muted hover:text-cream"
                    aria-label={`Cancel renaming ${conversation.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenamingId("");
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="rounded p-1 text-cream-muted hover:text-cream"
                    aria-label={`Rename ${conversation.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenamingId(conversation.id);
                      setDraftTitle(conversation.title);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-cream-muted hover:text-red-300"
                    aria-label={`Delete ${conversation.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onDelete(conversation.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QuietState(props: { icon: LucideIcon; title: string; text: string }) {
  const Icon = props.icon;
  return (
    <div className="grid min-h-[280px] place-items-center px-8 text-center">
      <div>
        <Icon className="mx-auto size-5 text-cream-muted" strokeWidth={1.7} />
        <h3 className="mt-3 text-sm font-medium text-cream">{props.title}</h3>
        <p className="mt-1 text-xs text-cream-muted">{props.text}</p>
      </div>
    </div>
  );
}

export function ModeIcon({ mode, className }: { mode: GlobalAiMode; className?: string }) {
  const Icon = mode === "search" ? Search : mode === "ask" ? MessageCircle : CheckSquare2;
  return <Icon className={cn("size-4 shrink-0 text-cream-muted", className)} />;
}

const resultIcons: Record<GlobalSearchKind, LucideIcon> = {
  space: FolderKanban,
  task: CheckSquare2,
  note: NotebookPen,
  message: MessageCircle,
  conversation: MessageCircle,
  calendar: CalendarDays,
  roadmap: MapIcon,
  drawing: Paintbrush,
  activity: Bell,
  library: Library,
  folder: Folder,
  file: File,
  agent: Bot,
  workflow: Workflow,
  action: CheckSquare2,
};

function kindLabel(kind: GlobalSearchKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
