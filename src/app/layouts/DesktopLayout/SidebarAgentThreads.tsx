import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  AgentAvatar,
  forkChat,
  isChatUnread,
  setChatsArchived,
  setChatsPinned,
  useChatFolders,
  useMistyStore,
  useOthersThreads,
  useThreadWork,
  type ChatStatus,
  type SharedThread,
} from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DisclosureButton,
  IconButton,
  MenuItem,
  NavBranch,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  RenameItemDialog,
  RowActions,
  RowTools,
  StateMark,
  Tooltip,
  useConfirmDelete,
} from "@misty/ui";
import { attentionByAgent } from "./attention";
import { faceSlotClass } from "./styles";
import type { SidebarChat } from "./sidebar_types";

const rank: Record<string, number> = { working: 3, "needs-you": 2, failed: 1 };
const firstThreads = 5;

const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

const stateLabel = (status: ChatStatus | undefined) =>
  status === "working"
    ? "Working"
    : status === "needs-you"
      ? "Needs you"
      : status === "failed"
        ? "Failed"
        : "";

const sharedStatus = (state: SharedThread["state"]): ChatStatus | undefined =>
  state === "working" || state === "landing"
    ? "working"
    : state === "needs-you"
      ? "needs-you"
      : undefined;

function ThreadMark({ status, unread }: { status?: ChatStatus; unread?: boolean }) {
  const label = stateLabel(status);
  if (status && label)
    return (
      <StateMark
        kind={status === "working" ? "working" : status === "needs-you" ? "waiting" : "failed"}
        label={label}
      />
    );
  if (unread) return <StateMark kind="results" />;
  return null;
}

function AgentRowMenu({ onClose, children }: { onClose?(): void; children: ReactNode }) {
  if (!onClose) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItem icon={X} label="Close conversation" onSelect={onClose} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export type SidebarAgentPlace = {
  agent: string | null;
  conversation: string | null;
  thread: string | null;
};

export function SidebarAgentThreads({
  agents,
  chats,
  statuses,
  here,
  tabbed = [],
  spaceId,
  accountId,
  onOpen,
  onNewThread,
  onOpenThread,
  onOpenShared,
  onClose,
  children,
}: {
  agents: AgentProfile[];
  chats: SidebarChat[];
  statuses: Record<string, ChatStatus>;
  here: SidebarAgentPlace;
  tabbed?: string[];
  spaceId: string;
  accountId: string;
  onOpen(agent: AgentProfile): void;
  onNewThread(agent: AgentProfile): void;
  onOpenThread(agent: AgentProfile, conversationId: string): void;
  onOpenShared(agent: AgentProfile, threadId: string): void;
  onClose?(agent: AgentProfile): void;
  children?: ReactNode;
}) {
  const rows = useMemo(() => {
    const byAgent = new Map<string, ChatStatus>();
    for (const chat of chats) {
      if (!chat.agentId || chat.archivedAt) continue;
      const status = statuses[chat.id];
      const known = byAgent.get(chat.agentId);
      if (status && (rank[status] ?? 0) > (rank[known ?? ""] ?? 0))
        byAgent.set(chat.agentId, status);
    }
    const attention = attentionByAgent(chats, statuses);
    return agents
      .filter((agent) => agent.enabled && !agent.system_managed)
      .map((agent) => ({
        agent,
        status: byAgent.get(agent.id),
        attention: attention.get(agent.id) ?? { count: 0, waiting: false },
      }));
  }, [agents, chats, statuses]);
  if (children) return <>{children}</>;
  return (
    <>
      {rows.map(({ agent, status, attention }) => {
        const isHere = here.agent === agent.id;
        const expanded = isHere || tabbed.includes(agent.id);
        const onThread = isHere && Boolean(here.conversation || here.thread);
        return (
          <div key={agent.id} className="flex flex-col gap-1.5">
            <AgentRowMenu onClose={onClose ? () => onClose(agent) : undefined}>
              <div className="group/row relative">
                <NavRow
                  face
                  current={isHere && !onThread}
                  aria-expanded={expanded}
                  aria-busy={status === "working" || undefined}
                  onClick={() => onOpen(agent)}
                >
                  <span className={faceSlotClass}>
                    <AgentAvatar agent={agent} face />
                  </span>
                  <NavRowLabel
                    bright={isHere || status === "working" || attention.count > 0}
                    className="min-w-0"
                  >
                    {agent.name}
                  </NavRowLabel>
                  <span className="flex-1" />
                  {expanded ? null : attention.waiting ? (
                    <ThreadMark status="needs-you" />
                  ) : status ? (
                    <ThreadMark status={status} />
                  ) : (
                    <ThreadMark unread={attention.count > 0} />
                  )}
                </NavRow>
                <RowTools reveal="cover" ground="chrome">
                  <IconButton label="New thread" onClick={() => onNewThread(agent)}>
                    <SquarePen />
                  </IconButton>
                  {onClose ? (
                    <IconButton label="Close conversation" onClick={() => onClose(agent)}>
                      <X />
                    </IconButton>
                  ) : null}
                </RowTools>
              </div>
            </AgentRowMenu>
            {expanded ? (
              <AgentThreadRows
                agent={agent}
                chats={chats}
                statuses={statuses}
                here={here}
                spaceId={spaceId}
                accountId={accountId}
                onOpenAgent={onOpen}
                onOpenThread={onOpenThread}
                onOpenShared={onOpenShared}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function AgentThreadRows({
  agent,
  chats,
  statuses,
  here,
  spaceId,
  accountId,
  onOpenAgent,
  onOpenThread,
  onOpenShared,
}: {
  agent: AgentProfile;
  chats: SidebarChat[];
  statuses: Record<string, ChatStatus>;
  here: SidebarAgentPlace;
  spaceId: string;
  accountId: string;
  onOpenAgent(agent: AgentProfile): void;
  onOpenThread(agent: AgentProfile, conversationId: string): void;
  onOpenShared(agent: AgentProfile, threadId: string): void;
}) {
  const [all, setAll] = useState(false);
  const [renaming, setRenaming] = useState<SidebarChat | null>(null);
  const renameConversation = useMistyStore((state) => state.renameConversation);
  const deleteConversation = useMistyStore((state) => state.deleteConversation);
  const { confirm, dialog } = useConfirmDelete();
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const openThread = !here.thread ? here.conversation : null;
  const remove = (targets: SidebarChat[]) =>
    void confirm({
      title:
        targets.length > 1
          ? `Delete ${targets.length} threads?`
          : `Delete "${targets[0]?.title || "New thread"}"?`,
      what:
        targets.length > 1
          ? "Their messages and any work they haven't landed are deleted. This can't be undone."
          : "Its messages and any work it hasn't landed are deleted. This can't be undone.",
      onConfirm: async () => {
        const gone: string[] = [];
        try {
          for (const chat of targets) {
            await deleteConversation(chat.id);
            gone.push(chat.id);
          }
        } finally {
          setSelected((known) => known.filter((id) => !gone.includes(id)));
          if (openThread && gone.includes(openThread)) onOpenAgent(agent);
        }
      },
    });
  const clashes = useThreadWork((state) => state.byConversation);
  const others = useOthersThreads(spaceId, agent.id, accountId);
  const projectChats = useChatFolders((state) => state.projectChats);
  useEffect(() => {
    if (!projectChats)
      void useChatFolders
        .getState()
        .loadProjectChats()
        .catch(() => undefined);
  }, [projectChats]);
  const [showArchived, setShowArchived] = useState(false);
  const own = useMemo(() => chats.filter((chat) => chat.agentId === agent.id), [chats, agent.id]);
  const archived = own.filter((chat) => chat.archivedAt);
  const groups = useMemo(() => {
    const active = own.filter((chat) => !chat.archivedAt);
    const pinned = active
      .filter((chat) => chat.pinnedAt)
      .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
    const rest = active.filter((chat) => !chat.pinnedAt);
    const loose = rest.filter((chat) => !projectChats?.[chat.id]);
    const byProject = new Map<string, SidebarChat[]>();
    for (const chat of rest) {
      const path = projectChats?.[chat.id];
      if (path) byProject.set(path, [...(byProject.get(path) ?? []), chat]);
    }
    return [
      ...(pinned.length ? [{ key: "pinned", name: "Pinned", chats: pinned }] : []),
      { key: "loose", name: "", chats: loose },
      ...[...byProject].map(([path, list]) => ({
        key: `project:${path}`,
        name: folderName(path),
        chats: list,
      })),
    ];
  }, [own, projectChats]);
  const theirs = others.others ?? [];
  const mineCount = groups.reduce((sum, group) => sum + group.chats.length, 0);
  const count = mineCount + theirs.length;
  const cut = !all && count > firstThreads;
  let room = cut ? firstThreads : Infinity;
  const shownGroups = groups
    .map((group) => {
      const shown = group.chats.slice(0, Math.max(0, room));
      room -= shown.length;
      return { ...group, chats: shown };
    })
    .filter((group) => group.chats.length);
  const shownTheirs = cut ? theirs.slice(0, Math.max(0, room)) : theirs;
  const shown = [
    ...shownGroups.flatMap((group) => group.chats.map((chat) => chat.id)),
    ...(showArchived ? archived.map((chat) => chat.id) : []),
  ];
  const picks = selected.filter((id) => shown.includes(id));
  const statusOf = (chat: SidebarChat): ChatStatus | undefined =>
    clashes[chat.id]?.state === "clashed" ? "needs-you" : statuses[chat.id];
  const pick = (id: string, event: MouseEvent) => {
    if (event.shiftKey) {
      const from = shown.indexOf(anchor.current ?? openThread ?? id);
      const to = shown.indexOf(id);
      if (from >= 0 && to >= 0) {
        setSelected(shown.slice(Math.min(from, to), Math.max(from, to) + 1));
        return;
      }
    }
    anchor.current = id;
    const start = picks.length ? picks : openThread && openThread !== id ? [openThread] : [];
    setSelected(start.includes(id) ? start.filter((known) => known !== id) : [...start, id]);
  };
  const threadRow = (chat: SidebarChat) => {
    const picked = openThread === chat.id;
    const status = statusOf(chat);
    const unread = isChatUnread(chat);
    const ids = picks.includes(chat.id) && picks.length > 1 ? picks : [chat.id];
    const many = ids.length > 1;
    const targets = own.filter((item) => ids.includes(item.id));
    const working = targets.some((item) => statusOf(item) === "working");
    const allPinned = targets.every((item) => item.pinnedAt);
    const count = many ? ` ${ids.length} threads` : "";
    return (
      <div key={chat.id} className="group/row relative flex flex-col">
        <NavRow
          nested="face"
          hover="fill"
          current={picked}
          selected={picks.includes(chat.id)}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) {
              pick(chat.id, event);
              return;
            }
            setSelected([]);
            anchor.current = chat.id;
            onOpenThread(agent, chat.id);
          }}
        >
          <NavRowLabel bright={picked || unread} className="min-w-0 flex-1">
            {chat.title || "New thread"}
          </NavRowLabel>
          <ThreadMark status={status} unread={unread} />
        </NavRow>
        <RowTools reveal="cover" ground="chrome">
          <RowActions label="Thread actions">
            {() => (
              <>
                {chat.archivedAt ? (
                  <MenuItem
                    icon={ArchiveRestore}
                    label={`Unarchive${count}`}
                    onSelect={() => {
                      setChatsArchived(ids, false);
                      setSelected([]);
                    }}
                  />
                ) : (
                  <MenuItem
                    icon={allPinned ? PinOff : Pin}
                    label={allPinned ? `Unpin${count}` : `Pin${count}`}
                    onSelect={() => setChatsPinned(ids, !allPinned)}
                  />
                )}
                {many ? null : (
                  <MenuItem
                    icon={GitFork}
                    label="Fork"
                    disabled={working}
                    reason="Wait for the reply to finish"
                    onSelect={() => {
                      const copy = forkChat(chat.id);
                      if (copy) onOpenThread(agent, copy);
                    }}
                  />
                )}
                {many ? null : (
                  <MenuItem icon={Pencil} label="Rename" onSelect={() => setRenaming(chat)} />
                )}
                {chat.archivedAt ? null : (
                  <MenuItem
                    icon={Archive}
                    label={`Archive${count}`}
                    disabled={working}
                    reason="Stop the reply first"
                    onSelect={() => {
                      setChatsArchived(ids, true);
                      setSelected([]);
                    }}
                  />
                )}
                <MenuItem
                  icon={Trash2}
                  label={`Delete${count}`}
                  danger
                  disabled={working}
                  reason="Stop the reply first"
                  onSelect={() => remove(targets)}
                />
              </>
            )}
          </RowActions>
        </RowTools>
      </div>
    );
  };
  return (
    <>
      <NavBranch
        under="face"
        onKeyDown={(event) => {
          if (event.key === "Escape" && picks.length) setSelected([]);
        }}
      >
        {shownGroups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1.5">
            {group.name ? <NavGroupHeading name={group.name} className="pl-10" /> : null}
            {group.chats.map(threadRow)}
          </div>
        ))}
        {shownTheirs.map((thread) => {
          const picked = here.thread === thread.id;
          return (
            <Tooltip key={thread.id} content={`${thread.owner_name}'s thread`}>
              <NavRow
                nested="face"
                hover="fill"
                current={picked}
                onClick={() => onOpenShared(agent, thread.id)}
              >
                <NavRowLabel bright={picked} className="min-w-0 flex-1">
                  {thread.title || "Thread"}
                </NavRowLabel>
                <ThreadMark status={sharedStatus(thread.state)} />
              </NavRow>
            </Tooltip>
          );
        })}
        {count > firstThreads ? (
          <div key="more" className="pl-10">
            <DisclosureButton open={all} onClick={() => setAll((value) => !value)}>
              {all ? "Show fewer" : "Show all"}
            </DisclosureButton>
          </div>
        ) : null}
        {archived.length ? (
          <div key="archived" className="flex flex-col gap-1.5">
            <NavGroupHeading
              name={`${archived.length} archived`}
              collapsible={{ open: showArchived, onToggle: () => setShowArchived((open) => !open) }}
              className="pl-10"
            />
            {showArchived ? archived.map(threadRow) : null}
          </div>
        ) : null}
      </NavBranch>
      {renaming ? (
        <RenameItemDialog
          key={renaming.id}
          title="Rename thread"
          initialName={renaming.title || ""}
          onConfirm={(title) => renameConversation(renaming.id, title)}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {dialog}
    </>
  );
}
