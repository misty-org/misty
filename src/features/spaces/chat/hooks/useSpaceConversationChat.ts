import { spacesApi } from "../../api/api";
import type { SpaceConversation, SpaceEvent, SpaceMessage } from "../../api/dto/entities";
import { readApiSessionGeneration } from "@/api/client/session";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { spaceMessagePageSize } from "../../api/chat";
import {
  historyAfterNewestPage,
  mergeNewestSpaceMessagePage,
  mergeSpaceMessages,
  messageFromSpaceEvent,
  oldestServerMessage,
  type SpaceMessageHistory,
} from "../useSpaceMessageSpansStore";
import { spacesResyncEvent } from "../../list/spacesResync";
import { reloadSpaceConversations, useSpaceConversationList } from "../spaceConversationsResource";

const pendingByConversation = new Map<string, SpaceMessage[]>();
const noConversations: SpaceConversation[] = [];
let pendingGeneration = -1;
export function useSpaceConversationChat(spaceId: string, conversationId: string) {
  // The Space's conversations come from the one cached list every chat screen shares, so a
  // revisit paints the open chat's title and members at once.
  const conversationList = useSpaceConversationList(conversationId ? spaceId : "");
  const conversations = conversationId
    ? (conversationList.data ?? noConversations)
    : noConversations;
  const session = readApiSessionGeneration();
  if (pendingGeneration !== session) {
    pendingByConversation.clear();
    pendingGeneration = session;
  }
  const key = `${session}:${spaceId}:${conversationId}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string; messages: SpaceMessage[] }>({
    key,
    messages: pendingByConversation.get(key) ?? [],
  });
  const messages =
    snapshot.key === key ? snapshot.messages : (pendingByConversation.get(key) ?? []);
  const frames = useRef(new Map<string, SpaceMessage[]>());
  const setMessages = useCallback<Dispatch<SetStateAction<SpaceMessage[]>>>(
    (action) => {
      if (session !== readApiSessionGeneration()) return;
      const previous = frames.current.get(key) ?? pendingByConversation.get(key) ?? [];
      const next = typeof action === "function" ? action(previous) : action;
      frames.current.set(key, next);
      pendingByConversation.set(
        key,
        next.filter((message) => message.local_delivery_state),
      );
      if (currentKey.current === key) setSnapshot({ key, messages: next });
    },
    [key, session],
  );
  // How far back this chat can still read, for the chat it was worked out for.
  const [historyState, setHistoryState] = useState<{ key: string; history: SpaceMessageHistory }>({
    key,
    history: "more",
  });
  const history = historyState.key === key ? historyState.history : "more";
  const historyRef = useRef(historyState);
  historyRef.current = historyState;
  const setHistory = useCallback(
    (next: SpaceMessageHistory | ((previous: SpaceMessageHistory) => SpaceMessageHistory)) => {
      if (currentKey.current !== key) return;
      const previous = historyRef.current.key === key ? historyRef.current.history : "more";
      const value = typeof next === "function" ? next(previous) : next;
      historyRef.current = { key, history: value };
      setHistoryState(historyRef.current);
    },
    [key],
  );
  const [loadedConversationId, setLoadedConversationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const activeConversationIdRef = useRef("");
  const reloadMessages = useCallback(() => setReloadRevision((current) => current + 1), []);
  useEffect(() => {
    if (!conversationId) {
      setMessages(pendingByConversation.get(key) ?? []);
      setLoadedConversationId("");
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    if (activeConversationIdRef.current !== conversationId) {
      activeConversationIdRef.current = conversationId;
      setMessages(pendingByConversation.get(key) ?? []);
    }
    setLoadedConversationId("");
    // A fresh newest page (newest first, as the server sends it) over what the chat shows.
    const applyNewestPage = (page: SpaceMessage[]) => {
      let keptEarlier = false;
      setMessages((current) => {
        const merged = mergeNewestSpaceMessagePage(current, [...page].reverse());
        keptEarlier = merged.keptEarlier;
        return merged.messages;
      });
      setHistory((previous) =>
        historyAfterNewestPage(previous, page.length, keptEarlier, spaceMessagePageSize),
      );
    };
    // The saved copy of the latest page paints first on a revisit or relaunch, behind which the
    // fresh page loads; it never replaces messages already on screen.
    const paintSaved = (saved: { messages: SpaceMessage[] }) => {
      if (!active) return;
      setMessages((current) =>
        current.some((message) => !message.local_delivery_state)
          ? current
          : mergeSpaceMessages(current, [...saved.messages].reverse()),
      );
      setLoadedConversationId(conversationId);
      setLoading(false);
    };
    void spacesApi
      .conversationMessages(spaceId, conversationId, 0, paintSaved)
      .then((messageResult) => {
        if (!active) return;
        applyNewestPage(messageResult.messages);
        setLoadedConversationId(conversationId);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "This group chat could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const reload = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spaceId?: string;
          conversationId?: string;
          event?: SpaceEvent;
        }>
      ).detail;
      if (detail?.spaceId !== spaceId || detail.conversationId !== conversationId) return;
      // Someone deleted a message: it leaves this chat by its id, with nothing to fetch.
      const deletedId =
        detail.event?.type === "message.deleted" &&
        typeof detail.event.payload.message_id === "string"
          ? detail.event.payload.message_id
          : "";
      if (deletedId) {
        setMessages((current) => current.filter((message) => message.id !== deletedId));
        return;
      }
      const includedMessage = detail.event ? messageFromSpaceEvent(detail.event) : undefined;
      if (includedMessage) {
        setMessages((current) => mergeSpaceMessages(current, [includedMessage]));
        return;
      }
      void spacesApi
        .conversationMessages(spaceId, conversationId)
        .then(({ messages: next }) => {
          if (!active) return;
          applyNewestPage(next);
          setError("");
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "This group chat could not be loaded.",
            );
        });
    };
    window.addEventListener("misty:space-message-event", reload);
    // Missed events: this chat fetches its messages afresh.
    const resync = () => reload(new CustomEvent("resync", { detail: { spaceId, conversationId } }));
    window.addEventListener(spacesResyncEvent, resync);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", reload);
      window.removeEventListener(spacesResyncEvent, resync);
    };
  }, [conversationId, reloadRevision, spaceId, key, setMessages, setHistory]);
  // The page before the oldest message shown, when the person scrolls back to the top.
  const loadOlder = useCallback(async () => {
    if (!conversationId || currentKey.current !== key) return;
    if ((historyRef.current.key === key ? historyRef.current.history : "more") !== "more") return;
    const shown = frames.current.get(key) ?? pendingByConversation.get(key) ?? [];
    const oldest = oldestServerMessage(shown);
    if (!oldest) return;
    setHistory("loading");
    try {
      const { messages: older } = await spacesApi.conversationMessages(
        spaceId,
        conversationId,
        oldest.seq,
      );
      if (currentKey.current !== key) return;
      // A reload meanwhile may have dropped the page this one goes before; it would leave a gap.
      const now = frames.current.get(key) ?? [];
      if (!now.some((message) => message.id === oldest.id)) {
        setHistory((previous) => (previous === "loading" ? "more" : previous));
        return;
      }
      setMessages((current) => mergeSpaceMessages(current, [...older].reverse()));
      setHistory(older.length < spaceMessagePageSize ? "complete" : "more");
    } catch {
      // Scrolling back to the top tries again.
      setHistory((previous) => (previous === "loading" ? "more" : previous));
    }
  }, [conversationId, key, setHistory, setMessages, spaceId]);
  const reload = useCallback(() => {
    reloadMessages();
    if (spaceId && conversationId) void reloadSpaceConversations(spaceId).catch(() => {});
  }, [conversationId, reloadMessages, spaceId]);
  return {
    conversations,
    /**
     * The conversation list has no copy yet, or is being read again: an open chat missing from
     * it may only be new, so it isn't called unavailable until the read settles.
     */
    conversationsPending:
      Boolean(conversationId) && (conversationList.loading || conversationList.refreshing),
    messages,
    setMessages,
    /** How far back this chat can still read. */
    history,
    loadOlder,
    loadedConversationId,
    loading,
    error:
      error ||
      (conversationList.error && !conversationList.data
        ? conversationList.error instanceof Error
          ? conversationList.error.message
          : "This group chat could not be loaded."
        : ""),
    setError: (value: string) => {
      if (currentKey.current === key) setError(value);
    },
    reload,
  };
}
