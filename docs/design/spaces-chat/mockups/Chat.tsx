import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  AtSign,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Hash,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  Reply,
  Send,
  SmilePlus,
  Star,
  Trash2,
  UsersRound,
  X,
  CircleAlert,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  InputGroup,
  InputGroupTextarea,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  Spinner,
} from "@/shared/ui";
import { ChatReplyBanner } from "@/features/spaces/chat/components/ChatReplyBanner";
import { ConversationIcon, EmojiPicker, useNarrow } from "./controls";
import { blankDraft, type Conversation, type Draft, type Message, type Scenario } from "./model";

export type ChatProps = {
  active: Conversation;
  conversations: Conversation[];
  messages: Message[];
  draft: Draft;
  scenario: Scenario;
  favorite: boolean;
  scrollPositions: Record<string, number>;
  onSwitch: (id: string) => void;
  onBrowse: () => void;
  onNew: () => void;
  onDraft: (draft: Draft) => void;
  onMessages: (messages: Message[]) => void;
  onFavorite: () => void;
  onOpenFile: (name: string) => void;
  onMembers: () => void;
  onNotice: (text: string) => void;
};

function Switcher({ p }: { p: ChatProps }) {
  const [open, setOpen] = useState(false);
  const movingToDialog = useRef(false);
  const closeFocus = (event: Event) => {
    if (movingToDialog.current) {
      event.preventDefault();
      movingToDialog.current = false;
    }
  };
  const narrow = useNarrow();
  const trigger = (
    <Button
      variant="ghost"
      aria-label={`Switch chat: ${p.active.title}`}
      className="max-w-full gap-2 px-2 text-base font-semibold"
    >
      <ConversationIcon conversation={p.active} />
      <span className="truncate">{p.active.title}</span>
      <ChevronDown size={14} />
    </Button>
  );
  const choose = (id: string) => {
    setOpen(false);
    p.onSwitch(id);
  };
  const content = (
    <Command label="Switch conversation">
      <CommandInput autoFocus placeholder="Find a conversation…" />
      <CommandList className="max-h-[min(55vh,380px)]">
        <CommandEmpty>No conversations found.</CommandEmpty>
        {(["Channels", "Direct messages", "Connected"] as const).map((group) => (
          <CommandGroup heading={group} key={group}>
            {p.conversations
              .filter((c) => c.group === group)
              .map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.title} ${c.subtitle}`}
                  onSelect={() => choose(c.id)}
                  className="gap-3 py-3"
                >
                  <ConversationIcon conversation={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.title}</span>
                    {c.group === "Connected" && (
                      <span className="block text-xs text-cream-muted">{c.subtitle}</span>
                    )}
                  </span>
                  {c.id === p.active.id ? (
                    <Check size={15} aria-label="Current conversation" />
                  ) : c.unread ? (
                    <span className="text-xs text-cream-muted">{c.unread} unread</span>
                  ) : null}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup>
          <CommandItem
            onSelect={() => {
              movingToDialog.current = true;
              setOpen(false);
              p.onNew();
            }}
          >
            <Plus />
            New chat
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              p.onBrowse();
            }}
          >
            <Hash />
            Browse all chats
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
  return narrow ? (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="p-0 pb-4 pt-12" onCloseAutoFocus={closeFocus}>
        <SheetTitle className="sr-only">Switch conversation</SheetTitle>
        <SheetDescription className="sr-only">Search chats in the family Space.</SheetDescription>
        {content}
      </SheetContent>
    </Sheet>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0" onCloseAutoFocus={closeFocus}>
        {content}
      </PopoverContent>
    </Popover>
  );
}

export function Chat(p: ChatProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const movingMessageFocus = useRef(false);
  const [editId, setEditId] = useState("");
  const [editText, setEditText] = useState("");
  const [deleting, setDeleting] = useState<Message>();
  const [below, setBelow] = useState(false);
  const canWrite = p.scenario !== "read-only" && !p.active.readOnly;
  const shown = p.scenario === "empty" || p.scenario === "loading" ? [] : p.messages;
  const reply = p.messages.find((m) => m.id === p.draft.reply);
  useLayoutEffect(() => {
    setEditId("");
    setEditText("");
    setDeleting(undefined);
    if (scroll.current)
      scroll.current.scrollTop = p.scrollPositions[p.active.id] ?? scroll.current.scrollHeight;
    if (scroll.current)
      setBelow(
        scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight > 100,
      );
  }, [p.active.id]);
  const bottom = () =>
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    });
  const update = (id: string, patch: Partial<Message>) =>
    p.onMessages(p.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const react = (id: string, emoji: string) => {
    const message = p.messages.find((m) => m.id === id);
    if (!message) return;
    const existing = message.reactions.find((r) => r.emoji === emoji);
    update(id, {
      reactions: existing
        ? message.reactions
            .map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r,
            )
            .filter((r) => r.count > 0)
        : [...message.reactions, { emoji, count: 1, mine: true }],
    });
  };
  const send = () => {
    if (
      !canWrite ||
      p.scenario === "loading" ||
      (!p.draft.text.trim() && !p.draft.attachments.length)
    )
      return;
    p.onMessages([
      ...p.messages,
      {
        id: crypto.randomUUID(),
        author: "You",
        time: "Now",
        text: p.draft.text.trim(),
        reply: p.draft.reply,
        attachment: p.draft.attachments.join(", ") || undefined,
        reactions: [],
      },
    ]);
    p.onDraft(blankDraft());
    bottom();
    textarea.current?.focus();
  };
  const keydown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const beginReply = (m: Message) => {
    p.onDraft({ ...p.draft, reply: m.id });
    textarea.current?.focus();
  };
  const beginEdit = (m: Message) => {
    setEditId(m.id);
    setEditText(m.text);
  };
  const save = () => {
    if (!editText.trim()) return;
    update(editId, { text: editText.trim(), edited: true });
    setEditId("");
  };
  const more = (m: Message) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`More actions for message from ${m.author}`} tooltip={false}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (movingMessageFocus.current) {
            event.preventDefault();
            movingMessageFocus.current = false;
          }
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard
              .writeText(m.text)
              .then(() => p.onNotice("Message copied"))
              .catch(() => p.onNotice("Could not copy. Select the message text to copy it."));
          }}
        >
          <Copy />
          Copy text
        </DropdownMenuItem>
        {canWrite && (
          <DropdownMenuItem
            onSelect={() => {
              movingMessageFocus.current = true;
              beginReply(m);
            }}
          >
            <Reply />
            Reply
          </DropdownMenuItem>
        )}
        {canWrite && m.author === "You" && !m.failed && (
          <DropdownMenuItem
            onSelect={() => {
              movingMessageFocus.current = true;
              beginEdit(m);
            }}
          >
            <Pencil />
            Edit message
          </DropdownMenuItem>
        )}
        {canWrite && m.author === "You" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                movingMessageFocus.current = true;
                setDeleting(m);
              }}
            >
              <Trash2 />
              Delete message
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <section className="chat-pane" aria-label={`${p.active.title} conversation`}>
      <header className="chat-header">
        <div className="min-w-0">
          <Switcher p={p} />
          <p className="chat-topic">{p.active.subtitle}</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Conversation participants" onClick={p.onMembers}>
            <UsersRound />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Conversation options" tooltip={false}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={p.onFavorite}>
                <Star />
                {p.favorite ? "Remove from favorites" : "Add to favorites"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={p.onBrowse}>
                <Hash />
                Browse all chats
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div
        ref={scroll}
        className="message-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          p.scrollPositions[p.active.id] = el.scrollTop;
          setBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
        }}
      >
        {p.scenario === "loading" ? (
          <div className="chat-empty">
            <Spinner label="Loading messages" />
            <p className="text-sm text-cream-muted">Getting the conversation ready…</p>
          </div>
        ) : !shown.length ? (
          <div className="chat-empty">
            <Hash size={36} strokeWidth={1.3} />
            <h2 className="text-xl font-semibold">This is {p.active.title}</h2>
            <p className="text-sm text-cream-muted">
              A place to share a thought, make a plan, or just say hello.
            </p>
            {canWrite && (
              <Button variant="outline" onClick={() => textarea.current?.focus()}>
                Write the first message
              </Button>
            )}
          </div>
        ) : (
          <div className="message-list">
            {shown.map((m) => (
              <div key={m.id}>
                {m.day && (
                  <div className="date-divider">
                    <span />
                    {m.day}
                    <span />
                  </div>
                )}
                <article
                  tabIndex={0}
                  id={`message-${m.id}`}
                  className={`message-row ${m.compact ? "compact" : ""}`}
                  aria-label={`Message from ${m.author}: ${m.text}`}
                >
                  {m.reply && (
                    <Button
                      variant="ghost"
                      size="none"
                      justify="start"
                      className="reply-preview"
                      onClick={() =>
                        document
                          .getElementById(`message-${m.reply}`)
                          ?.scrollIntoView({ block: "center", behavior: "smooth" })
                      }
                    >
                      <Avatar className="size-4 shrink-0">
                        <AvatarFallback className="bg-charcoal-hover text-[8px] text-cream">
                          {p.messages.find((x) => x.id === m.reply)?.author.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <strong>
                        {p.messages.find((x) => x.id === m.reply)?.author ??
                          "Original message unavailable"}
                      </strong>
                      <span className="truncate">
                        {p.messages.find((x) => x.id === m.reply)?.text}
                      </span>
                    </Button>
                  )}
                  <div className="message-avatar">
                    {m.compact ? (
                      <span className="compact-time">{m.time.replace(" AM", "")}</span>
                    ) : (
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-charcoal-hover text-xs text-cream">
                          {m.author === "You"
                            ? "AL"
                            : m.author
                                .split(" ")
                                .map((x) => x[0])
                                .join("")}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                  <div className="message-body">
                    {!m.compact && (
                      <div className="flex flex-wrap items-baseline gap-2">
                        <strong className="text-sm font-semibold">
                          {m.author === "You" ? "Alex Morgan" : m.author}
                        </strong>
                        {m.author === "You" && (
                          <span className="text-[11px] text-cream-muted">you</span>
                        )}
                        <time className="text-[11px] text-cream-muted">{m.time}</time>
                      </div>
                    )}
                    {editId === m.id ? (
                      <div className="mt-1">
                        <InputGroup>
                          <InputGroupTextarea
                            autoFocus
                            aria-label="Edit message"
                            value={editText}
                            maxLength={3000}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditId("");
                              else if (
                                e.key === "Enter" &&
                                !e.shiftKey &&
                                !e.nativeEvent.isComposing
                              ) {
                                e.preventDefault();
                                save();
                              }
                            }}
                          />
                        </InputGroup>
                        <div className="mt-2 flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditId("")}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!editText.trim()}
                            onClick={save}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="message-text">
                        {m.text.split(/(@You)/).map((text, i) =>
                          text === "@You" ? (
                            <span key={i} className="mention">
                              @Alex
                            </span>
                          ) : (
                            text
                          ),
                        )}
                        {m.edited && (
                          <span className="ml-1 text-[10px] text-cream-muted">(edited)</span>
                        )}
                      </p>
                    )}
                    {m.attachment &&
                      m.attachment.split(", ").map((name) => (
                        <Button
                          key={name}
                          variant="outline"
                          justify="start"
                          className="attachment"
                          onClick={() => p.onOpenFile(name)}
                        >
                          <FileText size={24} />
                          <span className="min-w-0 text-left">
                            <span className="block truncate">{name}</span>
                            <span className="block text-xs font-normal text-cream-muted">
                              Library attachment · Preview
                            </span>
                          </span>
                        </Button>
                      ))}
                    {m.failed && (
                      <div
                        role="alert"
                        className="mt-1 flex items-center gap-2 text-xs text-cream-muted"
                      >
                        <CircleAlert size={14} />
                        Message couldn’t be sent.
                        <Button
                          variant="link"
                          size="xs"
                          onClick={() => update(m.id, { failed: false })}
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                    {!!m.reactions.length && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.reactions.map((r) => (
                          <Button
                            key={r.emoji}
                            variant="chip"
                            size="chip"
                            disabled={!canWrite}
                            aria-pressed={Boolean(r.mine)}
                            aria-label={`${r.mine ? "Remove" : "Add"} ${r.emoji} reaction, ${r.count}`}
                            onClick={() => react(m.id, r.emoji)}
                          >
                            {r.emoji}
                            <span className="tabular-nums">{r.count}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="message-toolbar">
                    {canWrite && !m.failed && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="quick-reaction"
                          aria-label="Quick thumbs up"
                          onClick={() => react(m.id, "👍")}
                        >
                          👍
                        </Button>
                        <EmojiPicker onSelect={(emoji) => react(m.id, emoji)}>
                          <IconButton label="Add reaction" tooltip={false}>
                            <SmilePlus />
                          </IconButton>
                        </EmojiPicker>
                        <IconButton label="Reply to message" onClick={() => beginReply(m)}>
                          <Reply />
                        </IconButton>
                      </>
                    )}
                    {more(m)}
                  </div>
                </article>
              </div>
            ))}
          </div>
        )}
      </div>
      {below && (
        <Button className="jump-latest" variant="outline" size="sm" onClick={bottom}>
          <ArrowDown size={14} />
          Jump to latest
        </Button>
      )}
      {!canWrite ? (
        <div className="read-only">
          <LockKeyhole size={16} />
          <span>You can read this conversation. Sending messages is unavailable.</span>
        </div>
      ) : (
        <div className="composer-wrap">
          <InputGroup className="shadow-none">
            {p.draft.reply && (
              <ChatReplyBanner
                senderName={reply?.author ?? "an unavailable message"}
                onCancel={() => p.onDraft({ ...p.draft, reply: undefined })}
              />
            )}
            {!!p.draft.attachments.length && (
              <div className="flex flex-wrap gap-1 px-3 pt-3">
                {p.draft.attachments.map((name) => (
                  <Button
                    variant="chip"
                    size="chip"
                    key={name}
                    onClick={() =>
                      p.onDraft({
                        ...p.draft,
                        attachments: p.draft.attachments.filter((a) => a !== name),
                      })
                    }
                    aria-label={`Remove ${name}`}
                  >
                    <FileText size={12} />
                    {name}
                    <X size={12} />
                  </Button>
                ))}
              </div>
            )}
            <div className="composer-row">
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton label="Attach a file" tooltip={false}>
                    <Plus />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-72">
                  <p className="mb-2 text-xs text-cream-muted">From Library</p>
                  {["Coastal trail guide.pdf", "Weekend checklist.txt"].map((name) => (
                    <Button
                      key={name}
                      variant="ghost"
                      justify="start"
                      className="w-full"
                      disabled={p.draft.attachments.includes(name)}
                      onClick={() =>
                        p.onDraft({ ...p.draft, attachments: [...p.draft.attachments, name] })
                      }
                    >
                      <FileText />
                      {name}
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
              <InputGroupTextarea
                ref={textarea}
                aria-label={`Message ${p.active.title}`}
                placeholder={`Message ${p.active.title}`}
                className="min-h-11 py-3"
                value={p.draft.text}
                maxLength={3000}
                disabled={p.scenario === "loading"}
                onChange={(e) => p.onDraft({ ...p.draft, text: e.target.value })}
                onKeyDown={keydown}
              />
              <div className="composer-tools">
                <Popover>
                  <PopoverTrigger asChild>
                    <IconButton label="Mention someone" tooltip={false}>
                      <AtSign />
                    </IconButton>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="end" className="w-48">
                    {["Maya", "Leo", "Sam"].map((name) => (
                      <Button
                        key={name}
                        variant="ghost"
                        className="w-full"
                        justify="start"
                        onClick={() => {
                          p.onDraft({ ...p.draft, text: `${p.draft.text}@${name} ` });
                          textarea.current?.focus();
                        }}
                      >
                        @{name}
                      </Button>
                    ))}
                  </PopoverContent>
                </Popover>
                <EmojiPicker
                  onSelect={(emoji) => {
                    p.onDraft({ ...p.draft, text: p.draft.text + emoji });
                    textarea.current?.focus();
                  }}
                >
                  <IconButton label="Insert emoji" tooltip={false}>
                    <SmilePlus />
                  </IconButton>
                </EmojiPicker>
                <IconButton
                  variant="primary"
                  label="Send message"
                  disabled={
                    p.scenario === "loading" ||
                    (!p.draft.text.trim() && !p.draft.attachments.length)
                  }
                  onClick={send}
                >
                  <Send />
                </IconButton>
              </div>
            </div>
          </InputGroup>
          <div className="composer-hint">
            <span>Enter to send · Shift + Enter for a new line</span>
            {p.draft.text.length > 2800 && <span>{p.draft.text.length}/3000</span>}
          </div>
        </div>
      )}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete message?</DialogTitle>
            <DialogDescription>
              This message will be removed from this prototype conversation.
            </DialogDescription>
          </DialogHeader>
          <blockquote className="rounded-lg bg-charcoal-bg p-4 text-sm">
            {deleting?.text}
          </blockquote>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                p.onMessages(p.messages.filter((m) => m.id !== deleting?.id));
                setDeleting(undefined);
                p.onNotice("Message deleted");
              }}
            >
              Delete message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
