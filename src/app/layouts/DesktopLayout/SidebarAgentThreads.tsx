import { useMemo } from "react";
import { AgentAvatar, isChatUnread, type ChatStatus } from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import { Badge, NavRow, NavRowLabel, Spinner, Text, Tooltip } from "@misty/ui";
import { faceSlotClass } from "./styles";
import type { SidebarChat } from "./sidebar_types";

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
            <span className={faceSlotClass}>
              <AgentAvatar agent={agent} face />
            </span>
            <NavRowLabel bright={here || status === "working" || unread} className="min-w-0">
              {agent.name}
            </NavRowLabel>
            <Badge variant="secondary">Agent</Badge>
            <span className="flex-1" />
            {status && stateLabel ? (
              <Tooltip content={stateLabel}>
                <Text
                  bare
                  tone={
                    status === "working" ? "working" : status === "needs-you" ? "waiting" : "failed"
                  }
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
            ) : unread ? (
              <Text
                bare
                tone="chrome"
                className="size-1.5 flex-none rounded-full bg-current"
                aria-label="Unread"
              />
            ) : null}
          </NavRow>
        );
      })}
    </>
  );
}
