import { useCallback, useLayoutEffect, useRef, type UIEventHandler } from "react";

const storagePrefix = "misty.chat-scroll.v1:";
const bottomThreshold = 48;

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
  } catch {
    // Scroll memory should never make the chat itself unavailable.
  }
  return position;
}

interface ChatScrollRestorationOptions {
  viewerId?: string;
  spaceId: string;
  conversationId: string;
  ready: boolean;
  messages: readonly unknown[];
  pendingRunCount: number;
  targetMessageId?: string;
}

/** Keeps an independent viewport for Everyone and every Space conversation. */
export function useChatScrollRestoration(options: ChatScrollRestorationOptions) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const key = positionKey(options.viewerId, options.spaceId, options.conversationId);
  const restoredKeyRef = useRef("");
  const targetKeyRef = useRef("");
  const atBottomRef = useRef(true);

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      atBottomRef.current = writePosition(key, event.currentTarget).atBottom;
    },
    [key],
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    return () => {
      if (element) writePosition(key, element);
    };
  }, [key]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !options.ready) return;

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
    }
  }, [key, options.messages, options.pendingRunCount, options.ready, options.targetMessageId]);

  return { scrollRef, onScroll };
}

export function TestingClearChatScrollPositions() {
  positions.clear();
}
