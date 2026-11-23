import { useMemo, type ReactNode } from "react";
import { AgentAvatar, isChatUnread, type ChatStatus } from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import { NavGroupHeading, NavRow, NavRowLabel, Spinner, Text, Tooltip } from "@misty/ui";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { chatSectionClass, faceSlotClass } from "./styles";
import type { SidebarChat } from "./sidebar_types";

const rank: Record<string, number> = { working: 3, "needs-you": 2, failed: 1 };

const stateLabel = (status: ChatStatus | undefined) =>
  status === "working"
    ? "Working"
    : status === "needs-you"
      ? "Needs you"
      : status === "failed"
        ? "Failed"
        : "";

export function SidebarAgentThreads({
  agents,
  chats,
  statuses,
  openAgent,
  onOpen,
  children,
}: {
  agents: AgentProfile[];
  chats: SidebarChat[];
  statuses: Record<string, ChatStatus>;
  openAgent: string | null;
  onOpen(agent: AgentProfile): void;
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
            const here = openAgent === agent.id;
            const label = stateLabel(status);
            return (
              <NavRow
                key={agent.id}
                current={here}
                aria-busy={status === "working" || undefined}
                onClick={() => onOpen(agent)}
              >
                <span className={faceSlotClass}>
                  <AgentAvatar agent={agent} face />
                </span>
                <NavRowLabel bright={here || status === "working" || unread} className="min-w-0">
                  {agent.name}
                </NavRowLabel>
                <span className="flex-1" />
                {status && label ? (
                  <Tooltip content={label}>
                    <Text
                      bare
                      tone={
                        status === "working"
                          ? "working"
                          : status === "needs-you"
                            ? "waiting"
                            : "failed"
                      }
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
          }))
        : null}
    </section>
  );
}
