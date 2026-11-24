import { useMemo, useState, type ReactNode } from "react";
import { SquarePen } from "lucide-react";
import {
  AgentAvatar,
  isChatUnread,
  useOthersThreads,
  useThreadWork,
  type ChatStatus,
  type SharedThread,
} from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import {
  DisclosureButton,
  IconButton,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  RowTools,
  Spinner,
  Text,
  Tooltip,
} from "@misty/ui";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { chatSectionClass, faceSlotClass } from "./styles";
import type { SidebarChat } from "./sidebar_types";

const rank: Record<string, number> = { working: 3, "needs-you": 2, failed: 1 };
const firstThreads = 5;

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

function StateMark({ status, unread }: { status?: ChatStatus; unread?: boolean }) {
  const label = stateLabel(status);
  if (status && label)
    return (
      <Tooltip content={label}>
        <Text
          bare
          tone={status === "working" ? "working" : status === "needs-you" ? "waiting" : "failed"}
          role="img"
          aria-label={label}
          className="inline-flex flex-none items-center px-1 text-micro"
        >
          {status === "working" ? (
            <Spinner size="sm" label={false} />
          ) : (
            <span className="size-2 rounded-full bg-current" />
          )}
        </Text>
      </Tooltip>
    );
  if (unread)
    return (
      <Text
        bare
        tone="chrome"
        className="size-1.5 flex-none rounded-full bg-current"
        aria-label="Unread"
      />
    );
  return null;
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
  spaceId,
  accountId,
  onOpen,
  onNewThread,
  onOpenThread,
  onOpenShared,
  children,
}: {
  agents: AgentProfile[];
  chats: SidebarChat[];
  statuses: Record<string, ChatStatus>;
  here: SidebarAgentPlace;
  spaceId: string;
  accountId: string;
  onOpen(agent: AgentProfile): void;
  onNewThread(agent: AgentProfile): void;
  onOpenThread(agent: AgentProfile, conversationId: string): void;
  onOpenShared(agent: AgentProfile, threadId: string): void;
  children?: ReactNode;
}) {
  const collapsed = useCollapsedSections((state) => state.value);
  const open = !collapsed.includes("agents");
  const rows = useMemo(() => {
    const byAgent = new Map<string, { status?: ChatStatus; unread: boolean }>();
    for (const chat of chats) {
      if (!chat.agentId || chat.archivedAt) continue;
      const known = byAgent.get(chat.agentId) ?? { unread: false };
      const status = statuses[chat.id];
      if (status && (rank[status] ?? 0) > (rank[known.status ?? ""] ?? 0)) known.status = status;
      known.unread ||= isChatUnread(chat);
      byAgent.set(chat.agentId, known);
    }
    return agents
      .filter((agent) => agent.enabled && !agent.system_managed)
      .map((agent) => ({ agent, ...(byAgent.get(agent.id) ?? { unread: false }) }));
  }, [agents, chats, statuses]);
  if (!rows.length && !children) return null;
  return (
    <section className={chatSectionClass} aria-label="Agents">
      <NavGroupHeading
        name="Agents"
        collapsible={{ open, onToggle: () => toggleSection("agents") }}
      />
      {open
        ? (children ??
          rows.map(({ agent, status, unread }) => {
            const expanded = here.agent === agent.id;
            const onThread = expanded && Boolean(here.conversation || here.thread);
            return (
              <div key={agent.id} className="flex flex-col gap-1.5">
                <div className="group/row relative">
                  <NavRow
                    current={expanded && !onThread}
                    aria-expanded={expanded}
                    aria-busy={status === "working" || undefined}
                    onClick={() => onOpen(agent)}
                  >
                    <span className={faceSlotClass}>
                      <AgentAvatar agent={agent} face />
                    </span>
                    <NavRowLabel
                      bright={expanded || status === "working" || unread}
                      className="min-w-0"
                    >
                      {agent.name}
                    </NavRowLabel>
                    <span className="flex-1" />
                    {expanded ? null : <StateMark status={status} unread={unread} />}
                  </NavRow>
                  <RowTools reveal="cover">
                    <IconButton label="New thread" onClick={() => onNewThread(agent)}>
                      <SquarePen />
                    </IconButton>
                  </RowTools>
                </div>
                {expanded ? (
                  <AgentThreadRows
                    agent={agent}
                    chats={chats}
                    statuses={statuses}
                    here={here}
                    spaceId={spaceId}
                    accountId={accountId}
                    onOpenThread={onOpenThread}
                    onOpenShared={onOpenShared}
                  />
                ) : null}
              </div>
            );
          }))
        : null}
    </section>
  );
}

function AgentThreadRows({
  agent,
  chats,
  statuses,
  here,
  spaceId,
  accountId,
  onOpenThread,
  onOpenShared,
}: {
  agent: AgentProfile;
  chats: SidebarChat[];
  statuses: Record<string, ChatStatus>;
  here: SidebarAgentPlace;
  spaceId: string;
  accountId: string;
  onOpenThread(agent: AgentProfile, conversationId: string): void;
  onOpenShared(agent: AgentProfile, threadId: string): void;
}) {
  const [all, setAll] = useState(false);
  const clashes = useThreadWork((state) => state.byConversation);
  const others = useOthersThreads(spaceId, agent.id, accountId);
  const mine = useMemo(
    () => chats.filter((chat) => chat.agentId === agent.id && !chat.archivedAt),
    [chats, agent.id],
  );
  const theirs = others.others ?? [];
  const count = mine.length + theirs.length;
  const cut = !all && count > firstThreads;
  const shownMine = cut ? mine.slice(0, firstThreads) : mine;
  const shownTheirs = cut ? theirs.slice(0, Math.max(0, firstThreads - mine.length)) : theirs;
  return (
    <>
      {shownMine.map((chat) => {
        const picked = !here.thread && here.conversation === chat.id;
        const status: ChatStatus | undefined =
          clashes[chat.id]?.state === "clashed" ? "needs-you" : statuses[chat.id];
        const unread = isChatUnread(chat);
        return (
          <NavRow
            key={chat.id}
            nested
            hover="fill"
            current={picked}
            onClick={() => onOpenThread(agent, chat.id)}
          >
            <NavRowLabel bright={picked || unread} className="min-w-0 flex-1">
              {chat.title || "New thread"}
            </NavRowLabel>
            <StateMark status={status} unread={unread} />
          </NavRow>
        );
      })}
      {shownTheirs.map((thread) => {
        const picked = here.thread === thread.id;
        return (
          <Tooltip key={thread.id} content={`${thread.owner_name}'s thread`}>
            <NavRow
              nested
              hover="fill"
              current={picked}
              onClick={() => onOpenShared(agent, thread.id)}
            >
              <NavRowLabel bright={picked} className="min-w-0 flex-1">
                {thread.title || "Thread"}
              </NavRowLabel>
              <StateMark status={sharedStatus(thread.state)} />
            </NavRow>
          </Tooltip>
        );
      })}
      {count > firstThreads ? (
        <div className="pl-8">
          <DisclosureButton open={all} onClick={() => setAll((value) => !value)}>
            {all ? "Show fewer" : "Show all"}
          </DisclosureButton>
        </div>
      ) : null}
    </>
  );
}
