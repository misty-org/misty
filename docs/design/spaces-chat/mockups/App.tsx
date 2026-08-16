import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Gauge,
  Hash,
  Images,
  Layers,
  ListTodo,
  MessagesSquare,
  MoreHorizontal,
  Notebook,
  Plus,
  Star,
  UsersRound,
  X,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  CollectionHeading,
  CollectionPage,
  CollectionSearch,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  WorkspaceSidebar,
  WorkspaceSidebarHeading,
  WorkspaceSectionLabel,
} from "@/shared/ui";
import { Chat } from "./Chat";
import { Collection } from "./Collection";
import { ConversationIcon, itemIcons } from "./controls";
import {
  blankDraft,
  conversations as seedConversations,
  initialItems,
  initialMessages,
  type Conversation,
  type Draft,
  type Filter,
  type Item,
  type ItemKind,
  type Message,
  type Scenario,
} from "./model";

const nav = [
  { title: "All", icon: Layers },
  { title: "Chat", icon: MessagesSquare },
  { title: "Planner", icon: ListTodo },
  { title: "Journal", icon: Notebook },
  { title: "Library", icon: Images },
];
const validScenarios: Scenario[] = ["populated", "empty", "loading", "read-only", "failed"];
const params = new URLSearchParams(location.search);
const initialScenario = validScenarios.find((s) => s === params.get("state")) ?? "populated";

export function App() {
  const [page, setPage] = useState(params.get("view") === "all" ? "All" : "Chat");
  const [filter, setFilter] = useState<Filter>(
    params.get("filter") === "Suggested"
      ? "Suggested"
      : params.get("filter") === "Favorites"
        ? "Favorites"
        : "Yours",
  );
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [conversations, setConversations] = useState(seedConversations);
  const [activeId, setActiveId] = useState("everyone");
  const active = conversations.find((c) => c.id === activeId)!;
  const [messages, setMessages] = useState<Record<string, Message[]>>(() => {
    const seed: Record<string, Message[]> =
      initialScenario === "empty" ? {} : structuredClone(initialMessages);
    if (initialScenario === "failed")
      seed.everyone.push({
        id: "failed-demo",
        author: "You",
        text: "I’ll send the booking details here once it’s confirmed.",
        time: "Now",
        failed: true,
        reactions: [],
      });
    return seed;
  });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const scrollPositions = useRef<Record<string, number>>({});
  const [items, setItems] = useState<Item[]>(() =>
    initialScenario === "empty" ? [] : structuredClone(initialItems),
  );
  const [recents, setRecents] = useState<string[]>(
    initialScenario === "empty"
      ? []
      : [
          "everyone",
          "note-weekend",
          "file-map",
          "task-dinner",
          "weekend",
          "drawing",
          "note-packing",
        ],
  );
  const [moreRecents, setMoreRecents] = useState(false);
  const [opened, setOpened] = useState<Item>();
  const [management, setManagement] = useState<"Members" | "Usage">();
  const [creating, setCreating] = useState<ItemKind>();
  const [title, setTitle] = useState("");
  const [newGroup, setNewGroup] = useState<Conversation["group"]>("Channels");
  const [notice, setNotice] = useState("");
  const [chatQuery, setChatQuery] = useState("");
  const touchRecent = (id: string) =>
    setRecents((current) => [id, ...current.filter((x) => x !== id)]);
  const favorite = (id: string) =>
    setItems((current) => current.map((i) => (i.id === id ? { ...i, favorite: !i.favorite } : i)));
  const switchChat = (id: string) => {
    setActiveId(id);
    setPage("Chat");
    touchRecent(id);
    setConversations((current) =>
      current.map((c) => (c.id === id ? { ...c, unread: undefined } : c)),
    );
  };
  const openItem = (item: Item) => {
    touchRecent(item.id);
    if (item.kind === "chat") switchChat(item.id);
    else setOpened(item);
  };
  const startNew = (kind: ItemKind) => {
    setCreating(kind);
    setTitle("");
    setNewGroup("Channels");
  };
  const create = () => {
    if (!creating || !title.trim()) return;
    const id = crypto.randomUUID();
    const item: Item = {
      id,
      title: title.trim(),
      kind: creating,
      creator: "You",
      favorite: false,
      updated: "2026-09-30T23:00:00",
      description: "Your new item is ready. Changes in this preview last until you reload.",
    };
    setItems((current) => [item, ...current]);
    if (scenario === "empty") setScenario("populated");
    touchRecent(id);
    if (creating === "chat") {
      setConversations((current) => [
        ...current,
        {
          id,
          title: title.trim(),
          group: newGroup,
          subtitle:
            newGroup === "Direct messages"
              ? `Just you and ${title.trim()}`
              : "A new place to talk.",
        },
      ]);
      setMessages((current) => ({ ...current, [id]: [] }));
      setActiveId(id);
      setPage("Chat");
    } else setOpened(item);
    setCreating(undefined);
  };
  const setDemo = (value: Scenario) => {
    setScenario(value);
    if (value === "empty") {
      setItems([]);
      setMessages({});
      setRecents([]);
      setDrafts({});
    } else if (scenario === "empty") {
      setItems(structuredClone(initialItems));
      setMessages(structuredClone(initialMessages));
      setRecents([
        "everyone",
        "note-weekend",
        "file-map",
        "task-dinner",
        "weekend",
        "drawing",
        "note-packing",
      ]);
    }
    if (value === "failed")
      setMessages((current) => ({
        ...current,
        [activeId]: [
          ...(current[activeId] ?? []).filter((m) => m.id !== "failed-demo"),
          {
            id: "failed-demo",
            author: "You",
            text: "I’ll send the booking details here once it’s confirmed.",
            time: "Now",
            failed: true,
            reactions: [],
          },
        ],
      }));
  };
  const activeMessages = messages[activeId] ?? [];
  const sidebar = (
    <WorkspaceSidebar className="prototype-sidebar" aria-label="Space navigation">
      <WorkspaceSidebarHeading
        title="family"
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="About this Space" tooltip={false}>
                <MoreHorizontal />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="start">
              <p className="font-medium">family</p>
              <p className="mt-1 text-sm text-cream-muted">
                A shared Space for the everyday things.
              </p>
              <Button variant="ghost" className="mt-3" onClick={() => setManagement("Members")}>
                <UsersRound />
                View members
              </Button>
            </PopoverContent>
          </Popover>
        }
      />
      <Button
        variant="outline"
        className="mb-3 w-full"
        justify="start"
        onClick={() => startNew("note")}
      >
        <Plus />
        New item
      </Button>
      <nav className="space-y-1" aria-label="Space areas">
        {nav.map(({ title: name, icon: Icon }) => (
          <Button
            key={name}
            variant="ghost"
            justify="start"
            className="w-full gap-3 px-3"
            aria-current={
              page === name || (page === "Browse chats" && name === "Chat") ? "page" : undefined
            }
            aria-pressed={page === name || (page === "Browse chats" && name === "Chat")}
            onClick={() => {
              setPage(name);
            }}
          >
            <Icon size={18} />
            {name}
          </Button>
        ))}
      </nav>
      <section className="min-h-0 flex-1 overflow-y-auto" aria-label="Recent items">
        <WorkspaceSectionLabel>Recents</WorkspaceSectionLabel>
        {scenario === "empty" ? (
          <p className="px-2 text-xs leading-5 text-cream-muted">
            Items you open will appear here.
          </p>
        ) : (
          <nav className="space-y-1">
            {recents.slice(0, moreRecents ? undefined : 5).map((id) => {
              const item = items.find((i) => i.id === id);
              const conversation = conversations.find((c) => c.id === id);
              if (!item && !conversation) return null;
              const Icon = itemIcons[item?.kind ?? "chat"];
              return (
                <Button
                  key={id}
                  variant="ghost"
                  justify="start"
                  className="recent-link w-full gap-3 px-3 font-normal text-cream-muted"
                  title={item?.title ?? conversation?.title}
                  onClick={() => (item ? openItem(item) : switchChat(id))}
                >
                  <Icon size={16} />
                  <span className="truncate">{item?.title ?? conversation?.title}</span>
                </Button>
              );
            })}
            {recents.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 mt-1 text-xs text-cream-muted"
                onClick={() => setMoreRecents(!moreRecents)}
              >
                {moreRecents ? "Show less" : "Show more"}
              </Button>
            )}
          </nav>
        )}
      </section>
      <div className="flex shrink-0 flex-col gap-1 border-t border-charcoal-border pt-3">
        <Button
          variant="ghost"
          justify="start"
          className="gap-3 px-3"
          onClick={() => setManagement("Members")}
        >
          <UsersRound />
          Members
        </Button>
        <Button
          variant="ghost"
          justify="start"
          className="gap-3 px-3"
          onClick={() => setManagement("Usage")}
        >
          <Gauge />
          Usage
        </Button>
      </div>
    </WorkspaceSidebar>
  );
  return (
    <div className="prototype-root">
      <div className="prototype-topbar">
        <span className="font-semibold text-cream">misty</span>
        <span className="topbar-divider" />
        <span>Spaces</span>
        <span className="text-cream-muted">/</span>
        <span className="text-cream">family</span>
        <span className="ml-auto text-xs text-cream-muted">Interactive prototype</span>
      </div>
      <div className="prototype-workspace">
        {sidebar}
        <main className="prototype-main">
          {page === "Chat" ? (
            <Chat
              active={active}
              conversations={conversations}
              messages={activeMessages}
              draft={drafts[activeId] ?? blankDraft()}
              scenario={scenario}
              favorite={Boolean(items.find((i) => i.id === activeId)?.favorite)}
              scrollPositions={scrollPositions.current}
              onSwitch={switchChat}
              onBrowse={() => setPage("Browse chats")}
              onNew={() => startNew("chat")}
              onDraft={(draft) => setDrafts((current) => ({ ...current, [activeId]: draft }))}
              onMessages={(next) => {
                setMessages((current) => ({ ...current, [activeId]: next }));
                touchRecent(activeId);
                if (scenario === "empty") setScenario("populated");
              }}
              onFavorite={() => {
                if (!items.some((i) => i.id === activeId))
                  setItems((current) => [
                    ...current,
                    {
                      id: activeId,
                      title: active.title,
                      kind: "chat",
                      creator: "Maya",
                      favorite: true,
                      updated: "2026-09-30",
                      description: active.subtitle,
                    },
                  ]);
                else favorite(activeId);
              }}
              onOpenFile={(name) => {
                const file = items.find((item) => item.kind === "file" && item.title === name);
                if (file) openItem(file);
                else {
                  const attachment: Item = {
                    id: `attachment:${name}`,
                    title: name,
                    kind: "file",
                    creator: "You",
                    favorite: false,
                    updated: "2026-09-30",
                    description:
                      "Illustrative attachment preview. A short checklist for the weekend: bookings, groceries, and things to bring.",
                  };
                  setItems((current) => [...current, attachment]);
                  openItem(attachment);
                }
              }}
              onMembers={() => setManagement("Members")}
              onNotice={setNotice}
            />
          ) : page === "Browse chats" ? (
            <CollectionPage className="prototype-collection">
              <CollectionHeading
                title="Chat"
                actions={
                  <>
                    <CollectionSearch
                      aria-label="Search chats"
                      placeholder="Find a conversation"
                      value={chatQuery}
                      onChange={(e) => setChatQuery(e.target.value)}
                    />
                    <Button variant="primary" onClick={() => startNew("chat")}>
                      <Plus />
                      New chat
                    </Button>
                  </>
                }
              />
              {(["Channels", "Direct messages", "Connected"] as const).map((group) => (
                <section key={group}>
                  <WorkspaceSectionLabel>{group}</WorkspaceSectionLabel>
                  {conversations
                    .filter(
                      (c) =>
                        c.group === group &&
                        c.title.toLowerCase().includes(chatQuery.toLowerCase()),
                    )
                    .map((c) => (
                      <Button
                        variant="ghost"
                        justify="start"
                        key={c.id}
                        className="h-auto w-full gap-3 py-4"
                        onClick={() => switchChat(c.id)}
                      >
                        <ConversationIcon conversation={c} />
                        <span className="min-w-0 text-left">
                          <span className="block">{c.title}</span>
                          <span className="block truncate text-xs font-normal text-cream-muted">
                            {c.subtitle}
                          </span>
                        </span>
                        {c.unread && (
                          <span className="ml-auto text-xs text-cream-muted">
                            {c.unread} unread
                          </span>
                        )}
                      </Button>
                    ))}
                </section>
              ))}
              {conversations.every(
                (c) => !c.title.toLowerCase().includes(chatQuery.toLowerCase()),
              ) && <p className="text-sm text-cream-muted">No matching conversations.</p>}
            </CollectionPage>
          ) : (
            <Collection
              key={page}
              items={items}
              filter={filter}
              setFilter={setFilter}
              onFavorite={favorite}
              onOpen={openItem}
              onNew={startNew}
              area={page === "All" ? undefined : page}
              scenario={scenario}
            />
          )}
        </main>
      </div>
      <footer className="prototype-footer">
        <span>Sample content · Changes stay in this preview</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" aria-label="Preview state">
              {scenario === "populated" ? "Populated" : scenario}
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={scenario}
              onValueChange={(value) => setDemo(value as Scenario)}
            >
              {validScenarios.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {s === "populated"
                    ? "Populated"
                    : s === "read-only"
                      ? "Read only"
                      : s[0].toUpperCase() + s.slice(1)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="xs" onClick={() => location.reload()}>
          Reset
        </Button>
      </footer>
      {notice && (
        <div className="prototype-notice" role="status">
          {notice}
          <IconButton size="xs" label="Dismiss notice" onClick={() => setNotice("")}>
            <X />
          </IconButton>
        </div>
      )}
      <Dialog open={Boolean(management)} onOpenChange={(open) => !open && setManagement(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{management}</DialogTitle>
            <DialogDescription>
              {management === "Members"
                ? "The people in family."
                : "Illustrative usage for this Space."}
            </DialogDescription>
          </DialogHeader>
          {management === "Members" ? (
            <div className="space-y-4">
              {[
                "Alex Morgan",
                "Maya Chen",
                "Leo Park",
                "Sam Rivera",
                "Jo Williams",
                "Nora Ellis",
              ].map((name, i) => (
                <div key={name} className="flex items-center gap-3">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-charcoal-hover text-xs">
                      {name
                        .split(" ")
                        .map((x) => x[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 text-sm">{name}</span>
                  <span className="text-xs text-cream-muted">
                    {i === 0 ? "You · Member" : "Member"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <dl className="space-y-5 text-sm">
              <div className="flex justify-between">
                <dt>Library storage</dt>
                <dd>124 MB / 5 GB</dd>
              </div>
              <div className="flex justify-between">
                <dt>Members</dt>
                <dd>6</dd>
              </div>
              <div className="flex justify-between">
                <dt>Shared items</dt>
                <dd>{items.length}</dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(creating)} onOpenChange={(open) => !open && setCreating(undefined)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <DialogHeader>
              <DialogTitle>New {creating}</DialogTitle>
              <DialogDescription>
                {creating === "chat"
                  ? "Start a conversation in family."
                  : "Create a sample item in this preview."}
              </DialogDescription>
            </DialogHeader>
            {creating === "chat" && (
              <div className="my-4 flex gap-2">
                {(["Channels", "Direct messages"] as const).map((group) => (
                  <Button
                    type="button"
                    key={group}
                    variant="outline"
                    aria-pressed={newGroup === group}
                    onClick={() => setNewGroup(group)}
                  >
                    {group}
                  </Button>
                ))}
              </div>
            )}
            <label className="mb-2 mt-5 block text-sm" htmlFor="item-title">
              {creating === "chat" && newGroup === "Direct messages" ? "Person’s name" : "Name"}
            </label>
            <Input
              autoFocus
              id="item-title"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={creating === "chat" ? "e.g. Sunday dinner" : "Give it a name"}
            />
            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setCreating(undefined)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!title.trim()}>
                Create {creating}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(opened)} onOpenChange={(open) => !open && setOpened(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{opened?.title}</DialogTitle>
            <DialogDescription>
              {opened?.kind === "file"
                ? "Library preview"
                : opened?.kind === "task"
                  ? "Task details"
                  : opened?.kind === "drawing"
                    ? "Drawing notes"
                    : "Journal note"}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-7">{opened?.description}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => opened && favorite(opened.id)}>
              <Star
                className={items.find((i) => i.id === opened?.id)?.favorite ? "fill-current" : ""}
              />
              {items.find((i) => i.id === opened?.id)?.favorite ? "Favorited" : "Add to favorites"}
            </Button>
            {opened?.kind === "task" && (
              <Button
                variant="primary"
                onClick={() => {
                  setItems((current) =>
                    current.map((i) =>
                      i.id === opened.id ? { ...i, priority: undefined, reason: undefined } : i,
                    ),
                  );
                  setOpened(undefined);
                  setNotice("Task completed");
                }}
              >
                <Check />
                Mark complete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
