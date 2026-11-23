import { useCallback, useLayoutEffect, useRef, type UIEventHandler } from "react";

const storagePrefix = "misty.chat-scroll.v1:";
const bottomThreshold = 48;
const topThreshold = 600;

interface ChatScrollPosition {
  scrollTop: number;
  atBottom: boolean;
}

const positions = new Map<string, ChatScrollPosition>();

function positionKey(viewerId: string | undefined, spaceId: string, conversationId: string) {
  return `${viewerId || "anonymous"}:${spaceId}:${conversationId || "everyone"}`;
}

function readPosition(key: string): ChatScrollPosition | undefined {
  const remembered = positions.get(key);
  if (remembered) return remembered;
  try {
    const raw = window.sessionStorage.getItem(storagePrefix + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ChatScrollPosition>;
    if (!Number.isFinite(parsed.scrollTop) || typeof parsed.atBottom !== "boolean")
      return undefined;
    const position = { scrollTop: Math.max(0, parsed.scrollTop!), atBottom: parsed.atBottom };
    positions.set(key, position);
    return position;
  } catch {
    return undefined;
  }
}

function writePosition(key: string, element: HTMLDivElement) {
  const distanceFromBottom = element.scrollHeight - element.clientHeight - element.scrollTop;
  const position = {
    scrollTop: Math.max(0, element.scrollTop),
    atBottom: distanceFromBottom <= bottomThreshold,
  };
  positions.set(key, position);
  try {
    window.sessionStorage.setItem(storagePrefix + key, JSON.stringify(position));
  } catch {}
  return position;
}

interface ChatScrollRestorationOptions {
  viewerId?: string;
  spaceId: string;
  conversationId: string;
  ready: boolean;
  messages: readonly { id?: string }[];
  targetMessageId?: string;
  onReachTop?: () => void;
}

function contentOffset(element: HTMLDivElement, messageId: string): number | undefined {
  const message = document.getElementById(`message-${messageId}`);
  if (!message || !element.contains(message)) return undefined;
  return (
    message.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
  );
}

export function useChatScrollRestoration(options: ChatScrollRestorationOptions) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const key = positionKey(options.viewerId, options.spaceId, options.conversationId);
  const restoredKeyRef = useRef("");
  const targetKeyRef = useRef("");
  const atBottomRef = useRef(true);
  const anchorRef = useRef<{ key: string; id: string; offset: number } | null>(null);
  const onReachTopRef = useRef(options.onReachTop);
  onReachTopRef.current = options.onReachTop;

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const element = event.currentTarget;
      atBottomRef.current = writePosition(key, element).atBottom;
      if (restoredKeyRef.current === key && element.scrollTop <= topThreshold)
        onReachTopRef.current?.();
    },
    [key],
  );

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.style.overflowAnchor = "none";
  });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    return () => {
      if (element) writePosition(key, element);
    };
  }, [key]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !options.ready) return;
    const settle = () => {
      const targetKey = options.targetMessageId ? `${key}:${options.targetMessageId}` : "";
      if (targetKey && targetKeyRef.current !== targetKey) {
        const target = document.getElementById(`message-${options.targetMessageId}`);
        if (target) {
          target.scrollIntoView({ block: "center" });
          targetKeyRef.current = targetKey;
          atBottomRef.current = false;
          writePosition(key, element);
          restoredKeyRef.current = key;
          return;
        }
      }

      if (restoredKeyRef.current !== key) {
        const remembered = readPosition(key);
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollTop = remembered?.atBottom
          ? maximum
          : Math.min(remembered?.scrollTop ?? maximum, maximum);
        atBottomRef.current = remembered?.atBottom ?? true;
        restoredKeyRef.current = key;
        writePosition(key, element);
        return;
      }

      if (atBottomRef.current) {
        element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
        writePosition(key, element);
        return;
      }

      const anchor = anchorRef.current;
      if (anchor && anchor.key === key && options.messages[0]?.id !== anchor.id) {
        const offset = contentOffset(element, anchor.id);
        if (offset !== undefined && offset !== anchor.offset) {
          element.scrollTop += offset - anchor.offset;
          writePosition(key, element);
        }
      }
    };
    settle();
    const firstId = options.messages[0]?.id;
    const offset = firstId ? contentOffset(element, firstId) : undefined;
    anchorRef.current = firstId && offset !== undefined ? { key, id: firstId, offset } : null;
    if (restoredKeyRef.current === key && element.scrollHeight <= element.clientHeight)
      onReachTopRef.current?.();
  }, [key, options.messages, options.ready, options.targetMessageId]);

  return { scrollRef, onScroll };
}

export function TestingClearChatScrollPositions() {
  positions.clear();
}
