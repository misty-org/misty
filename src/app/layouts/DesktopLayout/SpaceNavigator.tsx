import {
  Brain,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  House,
  KanbanSquare,
  Library,
  MessagesSquare,
  NotebookPen,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/features/account";
import {
  conversationInSpace,
  EngineMark,
  hasEngineMark,
  shortAgo,
  useChatStatuses,
  type ChatStatus,
  useAgentAccountId,
  useMistyStore,
  usePersonalAgentsStore,
  useTeammateAgents,
} from "@/features/agents";
import {
  dockLeaves,
  useSpaceWindowStore,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { useWindowSpace } from "@/features/spaces";
import { IconButton, Pressable, Skeleton } from "@/shared/ui";
import { agentChatRoute, openNewChat, openWorkspaceRoute } from "./spaceNavigation";

const sections: { section: string; label: string; icon: LucideIcon }[] = [
  { section: "home", label: "Home", icon: House },
  { section: "chat", label: "Chat", icon: MessagesSquare },
  { section: "notes", label: "Journal", icon: NotebookPen },
  { section: "planner", label: "Planner", icon: KanbanSquare },
  { section: "calendar", label: "Calendar", icon: CalendarDays },
  { section: "library", label: "Library", icon: Library },
  { section: "memory", label: "Memory", icon: Brain },
];

/** The route of the page the person is looking at: the focused pane's open view. */
function useFocusedRoute(): string {
  return useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (leaf) => leaf.id === state.layout.focusedPaneId,
    );
    return pane?.views.find((view) => view.id === pane.activeViewId)?.route ?? "";
  });
}

function Row(props: { current?: boolean; icon?: ReactNode; label: string; onOpen(): void }) {
  return (
    <Pressable
      type="button"
      className="misty-space-nav-row"
      aria-current={props.current ? "page" : undefined}
      onClick={props.onOpen}
    >
      {props.icon ? <span className="misty-space-nav-icon">{props.icon}</span> : null}
      <span className="truncate">{props.label}</span>
    </Pressable>
  );
}

function RowSkeletons({ count, icon = true }: { count: number; icon?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="misty-space-nav-row" aria-hidden="true">
          {icon ? <Skeleton className="size-4 rounded-md" /> : null}
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </>
  );
}

const statusWords: Record<ChatStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  failed: "Failed",
  done: "",
};

/** A chat's row: its title, and under it what its agent is doing or when it was last touched. */
function ChatRow(props: {
  chat: { id: string; title: string; updatedAt: string };
  status?: ChatStatus;
  current: boolean;
  onOpen(): void;
}) {
  const word = props.status ? statusWords[props.status] : "";
  return (
    <Pressable
      type="button"
      className="misty-space-chat-row"
      aria-current={props.current ? "page" : undefined}
      data-status={props.status}
      onClick={props.onOpen}
    >
      <span className="misty-space-chat-title">{props.chat.title || "New conversation"}</span>
      <span className="misty-space-chat-meta">
        {word ? (
          <span className="misty-space-chat-status">
            <span className="misty-space-chat-dot" aria-hidden="true" />
            {word}
          </span>
        ) : null}
        <span className="ml-auto">{shortAgo(props.chat.updatedAt)}</span>
      </span>
    </Pressable>
  );
}

/** One agent's chats in this Space, under the agent's name; the name folds them away. */
function AgentChats(props: {
  name: string;
  mark?: ReactNode;
  statuses: Record<string, ChatStatus>;
  chats: { id: string; title: string; updatedAt: string }[];
  openChat: string | null;
  onChat(id: string): void;
  onNew(): void;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section>
      <div className="misty-space-nav-group">
        <Pressable
          type="button"
          className="misty-space-nav-group-name"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {props.mark}
          <span className="truncate">{props.name}</span>
          <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
        </Pressable>
        <IconButton label={`New chat with ${props.name}`} onClick={props.onNew}>
          <Plus className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      {open
        ? props.chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              status={props.statuses[chat.id]}
              current={props.openChat === chat.id}
              onOpen={() => props.onChat(chat.id)}
            />
          ))
        : null}
    </section>
  );
}

/**
 * What the sidebar holds: a new chat and the Space's pages at the top, then every chat the person
 * has in this Space, under the agent it is with. Each row opens in the focused pane.
 */
export function SpaceNavigator({ onOpen }: { onOpen(view: WorkspaceView): void }) {
  const { user, sessionExpired } = useAuth();
  const signedIn = Boolean(user) && !sessionExpired;
  const accountId = useAgentAccountId();
  const space = useWindowSpace();
  const identity = useSpaceWindowStore((state) => state.identity);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const agentsLoading = usePersonalAgentsStore((state) => state.loading);
  const conversations = useMistyStore((state) => state.conversations);
  const route = useFocusedRoute();
  const statuses = useChatStatuses();
  const teammates = useTeammateAgents((state) => state.agents);
  useEffect(() => {
    void usePersonalAgentsStore.getState().load(accountId);
    const chats = useMistyStore.getState();
    chats.setAccount(accountId);
    void chats.loadConversations().catch(() => undefined);
  }, [accountId]);

  const shownAgents = agents.filter((agent) => agent.enabled);
  const chats = useMemo(
    () =>
      conversations
        .filter((chat) => conversationInSpace(chat, identity) && chat.messages.length > 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [conversations, identity],
  );
  const [path, query = ""] = route.split("?");
  const openChat = path === "/agents" ? new URLSearchParams(query).get("conversation") : null;
  const base = space ? `/spaces/${encodeURIComponent(space.id)}` : "";
  const open = (target: string) => openWorkspaceRoute(target, onOpen);

  return (
    <>
      <nav className="misty-space-nav" aria-label="Space" data-misty-window-drag-block="true">
        <Row
          label="New chat"
          icon={<Plus className="size-4" aria-hidden="true" />}
          onOpen={() => openNewChat(onOpen)}
        />
        {!signedIn ? null : space ? (
          sections.map(({ section, label, icon: Icon }) => (
            <Row
              key={section}
              label={label}
              icon={<Icon className="size-4" aria-hidden="true" />}
              current={path === `${base}/${section}`}
              onOpen={() => open(`${base}/${section}`)}
            />
          ))
        ) : (
          <RowSkeletons count={sections.length} />
        )}
      </nav>
      <nav className="misty-space-chats" aria-label="Chats" data-misty-window-drag-block="true">
        {agentsLoading && !agents.length ? (
          <RowSkeletons count={3} icon={false} />
        ) : (
          shownAgents.map((agent) => (
            <AgentChats
              key={agent.id}
              name={agent.name}
              mark={
                hasEngineMark(agent.engine) ? <EngineMark engine={agent.engine} size={13} /> : null
              }
              statuses={statuses}
              chats={chats.filter(
                (chat) => chat.agentId === agent.id || (!chat.agentId && agent.system_managed),
              )}
              openChat={openChat}
              onChat={(id) => open(agentChatRoute(agent.id, id))}
              onNew={() => open(agentChatRoute(agent.id, undefined, true))}
            />
          ))
        )}
        {teammates.length ? (
          <section>
            <div className="misty-space-nav-group">
              <span className="misty-space-nav-group-name">Teammates</span>
            </div>
            {teammates.map((mate) => (
              <div key={mate.key} className="misty-space-nav-row" title={mate.doing || undefined}>
                <span className="truncate">
                  {mate.name} · {mate.owner}
                </span>
                {mate.state !== "resting" ? (
                  <span className="ml-auto shrink-0 text-2xs">
                    {mate.state === "needs-you" ? "Waiting" : "Working"}
                  </span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
      </nav>
    </>
  );
}
