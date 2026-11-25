import { useEffect, useMemo } from "react";
import { useAuth } from "@/features/account";
import { create } from "zustand";
import {
  homeSpaceOf,
  isChatUnread,
  useAgentAccountId,
  useChatStatuses,
  useLessonStore,
  useMistyStore,
  usePersonalAgentsStore,
  type ChatStatus,
} from "@/features/agents";
import { useSpaceWindowStore } from "@/features/app-windows";
import { useDms, useFriends } from "@/features/direct";
import { useSpacesStore } from "@/features/spaces";
import { invoke } from "@/native/invoke";
import { noticesMuted, useMessageNotices } from "@/shared/lib/message_notices";
import { hasTauriInternals } from "@/shared/platform/tauri";

export type AgentAttention = { count: number; waiting: boolean };

type AttentionChat = {
  id: string;
  agentId?: string;
  archivedAt?: string;
  markedUnread?: boolean;
  lastReadAt?: string;
  updatedAt: string;
};

export function attentionByAgent(
  chats: AttentionChat[],
  statuses: Record<string, ChatStatus>,
): Map<string, AgentAttention> {
  const byAgent = new Map<string, AgentAttention>();
  for (const chat of chats) {
    if (!chat.agentId || chat.archivedAt) continue;
    const needsYou = statuses[chat.id] === "needs-you";
    if (!needsYou && !isChatUnread(chat)) continue;
    const known = byAgent.get(chat.agentId) ?? { count: 0, waiting: false };
    byAgent.set(chat.agentId, { count: known.count + 1, waiting: known.waiting || needsYou });
  }
  return byAgent;
}

export function attentionLabel({ count, waiting }: AgentAttention): string {
  const things = count === 1 ? "thread" : "threads";
  return waiting ? `${count} ${things} need you or are new` : `${count} new ${things}`;
}

export const useSpaceMentions = create<{ bySpace: Record<string, number> }>(() => ({
  bySpace: {},
}));

export function useSpaceMentionCounting(): void {
  const { user } = useAuth();
  const current = useSpaceWindowStore((state) => state.identity.spaceId);
  useEffect(() => {
    if (!current) return;
    useSpaceMentions.setState((state) => {
      if (!state.bySpace[current]) return state;
      const bySpace = { ...state.bySpace };
      delete bySpace[current];
      return { bySpace };
    });
  }, [current]);
  useEffect(() => {
    const myId = user?.id;
    if (!myId) return;
    const onMessage = (raw: Event) => {
      const detail = (
        raw as CustomEvent<{
          spaceId?: string;
          event?: { type?: string; payload?: Record<string, unknown> };
        }>
      ).detail;
      const spaceId = detail?.spaceId;
      if (!spaceId || detail?.event?.type !== "message.created") return;
      if (useSpaceWindowStore.getState().identity.spaceId === spaceId) return;
      const payload = detail.event.payload ?? {};
      if (payload.sender_user_id === myId) return;
      const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
      if (!space || space.is_default) return;
      const content = Array.isArray(payload.content)
        ? (payload.content as { user_id?: unknown }[])
        : [];
      if (content.some((span) => span.user_id === myId))
        useSpaceMentions.setState((state) => ({
          bySpace: { ...state.bySpace, [spaceId]: (state.bySpace[spaceId] ?? 0) + 1 },
        }));
    };
    window.addEventListener("misty:space-message-event", onMessage);
    return () => window.removeEventListener("misty:space-message-event", onMessage);
  }, [user?.id]);
}

function useAgentAttentionBySpace(): {
  personal: AgentAttention;
  bySpace: Map<string, AgentAttention>;
} {
  const accountId = useAgentAccountId();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const lessons = useLessonStore((state) => state.lessons);
  const statuses = useChatStatuses();
  const personalSpace = useSpaceWindowStore((state) => state.personalSpaceId);
  return useMemo(() => {
    const chats = conversations.filter(
      (chat) => chat.messages.length > 0 && !chat.place && !lessons[chat.id],
    );
    const byAgent = attentionByAgent(chats, statuses);
    const personal: AgentAttention = { count: 0, waiting: false };
    const bySpace = new Map<string, AgentAttention>();
    for (const agent of agents) {
      if (!agent.enabled || agent.system_managed) continue;
      const attention = byAgent.get(agent.id);
      if (!attention?.count) continue;
      const home = homeSpaceOf(accountId, agent);
      const held =
        !home || home === personalSpace
          ? personal
          : (bySpace.get(home) ?? { count: 0, waiting: false });
      held.count += attention.count;
      held.waiting = held.waiting || attention.waiting;
      if (held !== personal && home) bySpace.set(home, held);
    }
    return { personal, bySpace };
  }, [accountId, agents, conversations, lessons, statuses, personalSpace]);
}

export function useAttentionCounts(): {
  personal: number;
  personalWaiting: boolean;
  spaces: number;
  bySpace: Map<string, AgentAttention>;
} {
  const dms = useDms().data;
  const friends = useFriends().data;
  const notices = useMessageNotices((state) => state.value);
  const invitations = useSpacesStore((state) => state.invitations.length);
  const mentions = useSpaceMentions((state) => state.bySpace);
  const agents = useAgentAttentionBySpace();
  const unreadDms = (dms ?? []).reduce(
    (total, dm) =>
      noticesMuted(notices, dm.id) ? total : total + Math.max(0, dm.unread_count ?? 0),
    0,
  );
  const bySpace = new Map<string, AgentAttention>();
  for (const [id, attention] of agents.bySpace) bySpace.set(id, { ...attention });
  for (const [id, count] of Object.entries(mentions)) {
    const held = bySpace.get(id) ?? { count: 0, waiting: false };
    bySpace.set(id, { ...held, count: held.count + count });
  }
  const spaces = [...bySpace.values()].reduce((total, item) => total + item.count, 0);
  return {
    personal: unreadDms + (friends?.incoming.length ?? 0) + agents.personal.count,
    personalWaiting: agents.personal.waiting,
    spaces: spaces + invitations,
    bySpace,
  };
}

export function useAppBadge(): void {
  const counts = useAttentionCounts();
  const shown = useMessageNotices((state) => state.value.badge);
  const total = shown ? counts.personal + counts.spaces : 0;
  useEffect(() => {
    if (!hasTauriInternals()) return;
    void invoke("app_set_badge", { count: total }).catch(() => undefined);
  }, [total]);
}

export function AppBadgeSync(): null {
  useAppBadge();
  return null;
}
