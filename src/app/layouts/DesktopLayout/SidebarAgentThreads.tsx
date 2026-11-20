import { useMemo } from "react";
import {
  AgentAvatar,
  isChatUnread,
  shortAgo,
  type ChatStatus,
} from "@/features/agents";
import { useNow } from "@/shared/hooks/useNow";
import type { AgentProfile } from "@/shared/schemas";
import { NavRow, NavRowLabel, Spinner, Text, Tooltip } from "@misty/ui";
import { markSlotClass } from "./styles";
import type { SidebarChat } from "./sidebarTypes";

/**
 * Each of the person's agents as one direct message: a single long thread that carries on from one
 * day to the next. `/clear` clears the agent's context, not this thread. The thread is the agent's
 * most recently used chat; an agent with none yet opens a new one, which becomes its thread.
 */
export function SidebarAgentThreads({
  agents,
  chats,
  statuses,
  openChat,
  onOpen,
}: {
  agents: AgentProfile[];
  chats: SidebarChat[];
  statuses: Record<string, ChatStatus>;
  openChat: string | null;
  onOpen(agent: AgentProfile, chatId?: string): void;
}) {
  const now = useNow();
  const rows = useMemo(() => {
    const threadOf = new Map<string, SidebarChat>();
    for (const chat of chats) {
      if (!chat.agentId || chat.archivedAt) continue;
      const known = threadOf.get(chat.agentId);
      if (!known || chat.updatedAt > known.updatedAt) threadOf.set(chat.agentId, chat);
    }
    return agents
      .filter((agent) => agent.enabled && !agent.system_managed)
      .map((agent) => ({ agent, thread: threadOf.get(agent.id) }));
  }, [agents, chats]);
  return (
    <>
      {rows.map(({ agent, thread }) => {
        const here = Boolean(thread) && openChat === thread?.id;
        const status = thread ? statuses[thread.id] : undefined;
        const unread = thread ? isChatUnread(thread) : false;
        const stateLabel =
          status === "working"
            ? "Working"
            : status === "needs-you"
              ? "Needs you"
              : status === "failed"
                ? "Failed"
                : "";
        return (
          <NavRow
            key={agent.id}
            current={here}
            aria-busy={status === "working" || undefined}
            onClick={() => onOpen(agent, thread?.id)}
          >
            <span className={markSlotClass}>
              <AgentAvatar agent={agent} compact />
            </span>
            <NavRowLabel
              bright={here || status === "working" || unread}
              className="flex-1"
            >
              {agent.name}
            </NavRowLabel>
            {status && stateLabel ? (
              <Tooltip content={stateLabel}>
                <Text
                  bare
                  tone={status === "working" ? "working" : status === "needs-you" ? "waiting" : "failed"}
                  role="img"
                  aria-label={stateLabel}
                  className="inline-flex flex-none items-center px-1 text-micro"
                >
                  {status === "working" ? (
                    <Spinner size="sm" label={false} />
                  ) : (
                    <span className="size-2 rounded-full bg-current" />
                  )}
                </Text>
              </Tooltip>
            ) : thread ? (
              <span className="inline-flex flex-none items-center gap-1 text-micro tabular-nums">
                {unread ? (
                  <Text
                    bare
                    tone="chrome"
                    className="size-1.5 rounded-full bg-current"
                    aria-label="Unread"
                  />
                ) : null}
                {shortAgo(thread.updatedAt, now)}
              </span>
            ) : null}
          </NavRow>
        );
      })}
    </>
  );
}
