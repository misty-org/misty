import type { SpaceMember } from "../../api/dto/entities";
import { useSpacesStore } from "../../list/use_spaces_store";
import { spaceTypingScopeKey } from "../../list/realtime_types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const typingTimeoutMs = 1_800;
const typingRefreshMs = 1_000;
const emptyTypingByUser: Record<string, number> = {};

export function useSpaceChatTyping(options: {
  spaceId: string;
  conversationId: string;
  currentUserId?: string;
  members: SpaceMember[];
}) {
  const { spaceId, conversationId, currentUserId, members } = options;
  const sendTyping = useSpacesStore((state) => state.sendTyping);
  const scopeKey = spaceTypingScopeKey(spaceId, conversationId);
  const typingByUser = useSpacesStore(
    (state) => state.typingByConversation[scopeKey] ?? emptyTypingByUser,
  );
  const [now, setNow] = useState(Date.now());
  const active = useRef(false);
  const lastSentAt = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    if (!active.current) return;
    active.current = false;
    sendTyping(spaceId, conversationId, false);
  }, [conversationId, sendTyping, spaceId]);

  const onTextInput = useCallback(
    (text: string) => {
      if (!text.trim()) {
        stop();
        return;
      }
      const timestamp = Date.now();
      if (!active.current || timestamp - lastSentAt.current >= typingRefreshMs) {
        active.current = true;
        lastSentAt.current = timestamp;
        sendTyping(spaceId, conversationId, true);
      }
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = setTimeout(stop, typingTimeoutMs);
    },
    [conversationId, sendTyping, spaceId, stop],
  );

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const expiries = Object.values(typingByUser).filter((expiresAt) => expiresAt > Date.now());
    if (expiries.length === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...expiries) - Date.now() + 10);
    return () => clearTimeout(timer);
  }, [typingByUser]);

  const names = useMemo(
    () =>
      Object.entries(typingByUser)
        .filter(([userId, expiresAt]) => userId !== currentUserId && expiresAt > now)
        .map(([userId]) => members.find((member) => member.user_id === userId))
        .filter((member): member is NonNullable<typeof member> => Boolean(member))
        .map((member) => ({ userId: member.user_id, name: member.name })),
    [currentUserId, members, now, typingByUser],
  );
  const label = useMemo(() => {
    const named = names.map((person) => person.name);
    if (named.length === 0) return "";
    if (named.length === 1) return `${named[0]} is typing…`;
    if (named.length === 2) return `${named[0]} and ${named[1]} are typing…`;
    return `${named[0]}, ${named[1]} and ${named.length - 2} others are typing…`;
  }, [names]);

  return { label, names, onTextInput, stop };
}
