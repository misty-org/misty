import { companionReply } from "@/features/agents";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Input,
  MenuItem,
  MenuTrigger,
  Skeleton,
} from "@/shared/ui";
import {
  Check,
  ChevronDown,
  History,
  Library,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import { Link } from "react-router-dom";
import { MistyAppRequestCard } from "@/features/misty/MistyAppRequestCard";
import { ScreenRequestCard } from "@/features/misty/ScreenRequestCard";
import type { GlobalAiConversation } from "./types";
import { MistyActivityStatus } from "./MistyActivityStatus";
import { MistyMessageAttachments } from "./MistyMessageAttachments";

export function ConversationView(props: { conversation?: GlobalAiConversation; working: boolean }) {
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
              ? "ml-auto w-fit max-w-[82%] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-cream"
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
                  <MistyMarkdown>{companionReply(message.content).text}</MistyMarkdown>
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
                  <Button
                    key={citation.id}
                    asChild
                    variant="chip"
                    size="chip"
                    className="max-w-full font-normal"
                  >
                    <Link to={citation.href}>
                      <span className="truncate">{citation.title}</span>
                    </Link>
                  </Button>
                ))}
              </div>
            </details>
          ) : null}
          {message.appRequest ? (
            <MistyAppRequestCard messageId={message.id} request={message.appRequest} />
          ) : null}
          {message.screenRequest ? (
            <ScreenRequestCard messageId={message.id} request={message.screenRequest} />
          ) : null}
        </article>
      ))}
      {props.working ? (
        <p className="px-1 text-[11px] text-cream-muted">Answering with your context…</p>
      ) : null}
    </div>
  );
}

export function ConversationMenu(props: {
  compact?: boolean;
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
      {props.compact ? (
        <MenuTrigger
          iconOnly
          label="Conversation history"
          title="Conversation history"
          icon={<History className="size-3.5" />}
        />
      ) : (
        <MenuTrigger
          label="Conversation history"
          value={
            active?.title ??
            (props.loading ? <Skeleton className="h-3 w-24" /> : "New conversation")
          }
          icon={<History className="size-3.5" />}
          className="max-w-48 text-xs text-cream-muted"
        />
      )}
      <DropdownMenuContent align="end" width="xl" data-misty-layer-portal>
        <MenuItem
          icon={<Plus className="size-4" />}
          label="New conversation"
          onSelect={props.onNew}
        />
        {props.conversations.length ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Search className="size-3.5 text-cream-muted" />
              <Input
                variant="bare"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="h-7 flex-1 text-xs"
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
                <Input
                  variant="toolbar"
                  autoFocus
                  value={draftTitle}
                  aria-label={`Rename ${conversation.title}`}
                  className="h-7 min-w-0 flex-1"
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
                  <IconButton
                    label={`Save ${conversation.title}`}
                    className="p-1"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      finishRename();
                    }}
                  >
                    <Check className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Cancel renaming ${conversation.title}`}
                    className="p-1"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenamingId("");
                    }}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </>
              ) : (
                <>
                  <IconButton
                    label={`Rename ${conversation.title}`}
                    className="p-1"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenamingId(conversation.id);
                      setDraftTitle(conversation.title);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Delete ${conversation.title}`}
                    className="p-1 hover:text-red-300"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onDelete(conversation.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
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
