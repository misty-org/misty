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
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  GlobalAiActionProposal,
  GlobalAiConversation,
  GlobalAiMode,
  GlobalSearchKind,
  GlobalSearchResult,
} from "./types";

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
}) {
  if (!props.conversation?.messages.length)
    return (
      <QuietState
        icon={Sparkles}
        title="Start with Misty"
        text="Ask a grounded question or describe the action you want completed."
      />
    );
  return (
    <div className="space-y-4 p-4">
      {props.conversation.messages.map((message) => (
        <article
          key={message.id}
          className={cn(
            "max-w-[88%] rounded-xl px-3.5 py-3 text-sm leading-relaxed",
            message.role === "user"
              ? "ml-auto bg-cream text-charcoal-bg"
              : "border border-charcoal-border bg-charcoal-bg text-cream",
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.citations?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.citations.map((citation) => (
                <Link
                  key={citation.id}
                  to={citation.href}
                  className="rounded-full border border-charcoal-border bg-charcoal-card px-2 py-1 text-[10px] text-cream-muted hover:text-cream"
                >
                  {citation.title}
                </Link>
              ))}
            </div>
          ) : null}
          {message.action ? (
            <ActionProposal
              proposal={message.action}
              onConfirm={() => props.onConfirm(message.action!.id)}
              onReject={() => props.onReject(message.action!.id)}
            />
          ) : null}
        </article>
      ))}
      {props.working ? (
        <div className="flex items-center gap-2 text-xs text-cream-muted">
          <Loader2 className="size-3.5 animate-spin" /> Misty is working…
        </div>
      ) : null}
    </div>
  );
}

function ActionProposal(props: {
  proposal: GlobalAiActionProposal;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const proposal = props.proposal;
  return (
    <div className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-xs text-cream-bright">{proposal.title}</strong>
        <span className="text-[10px] uppercase tracking-wide text-cream-muted">
          {proposal.risk}
        </span>
      </div>
      {proposal.agentName ? (
        <p className="mt-1 text-[11px] text-cream-muted">
          Delegated to {proposal.agentName}
          {proposal.spaceName ? ` in ${proposal.spaceName}` : ""}
        </p>
      ) : null}
      {proposal.error ? <p className="mt-2 text-xs text-cream">{proposal.error}</p> : null}
      {proposal.state === "proposed" && proposal.requiresConfirmation ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="h-7" onClick={props.onConfirm}>
            <Check className="size-3.5" /> Confirm
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={props.onReject}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] capitalize text-cream-muted">
          {proposal.state.replace("_", " ")}
        </p>
      )}
    </div>
  );
}

export function ConversationMenu(props: {
  conversations: GlobalAiConversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const active = props.conversations.find((item) => item.id === props.activeId);
  const [query, setQuery] = useState("");
  const visible = props.conversations
    .filter((item) => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, 12);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 max-w-48 gap-1.5 text-xs text-cream-muted">
          <History className="size-3.5" />
          <span className="truncate">{active?.title ?? "Conversations"}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
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
        {visible.map((conversation) => (
          <DropdownMenuItem key={conversation.id} onSelect={() => props.onSelect(conversation.id)}>
            <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
            <button
              type="button"
              className="rounded p-1 text-cream-muted hover:text-cream"
              aria-label={`Delete ${conversation.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onDelete(conversation.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </DropdownMenuItem>
        ))}
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
  const Icon = mode === "search" ? Search : mode === "ask" ? Sparkles : CheckSquare2;
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
