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
  withThreadReply,
  withoutThreadReply,
  type SpaceMessageHistory,
} from "../use_space_message_spans_store";
import { spacesResyncEvent } from "../../list/spaces_resync";
import {
  reloadSpaceConversations,
  useSpaceConversationList,
} from "../space_conversations_resource";

const pendingByConversation = new Map<string, SpaceMessage[]>();
const noConversations: SpaceConversation[] = [];
let pendingGeneration = -1;
export function useSpaceConversationChat(spaceId: string, conversationId: string) {
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
      const deletedId =
        detail.event?.type === "message.deleted" &&
        typeof detail.event.payload.message_id === "string"
          ? detail.event.payload.message_id
          : "";
      if (deletedId) {
        const rootId = detail.event?.payload.thread_root_id;
        setMessages((current) => {
          const kept = current.filter((message) => message.id !== deletedId);
          return typeof rootId === "string" && rootId ? withoutThreadReply(kept, rootId) : kept;
        });
        return;
      }
      const includedMessage = detail.event ? messageFromSpaceEvent(detail.event) : undefined;
      if (includedMessage?.thread_root_id) {
        if (detail.event?.type === "message.created")
          setMessages((current) => withThreadReply(current, includedMessage));
        return;
      }
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
    const resync = () => reload(new CustomEvent("resync", { detail: { spaceId, conversationId } }));
    window.addEventListener(spacesResyncEvent, resync);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", reload);
      window.removeEventListener(spacesResyncEvent, resync);
    };
  }, [conversationId, reloadRevision, spaceId, key, setMessages, setHistory]);
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
      const now = frames.current.get(key) ?? [];
      if (!now.some((message) => message.id === oldest.id)) {
        setHistory((previous) => (previous === "loading" ? "more" : previous));
        return;
      }
      setMessages((current) => mergeSpaceMessages(current, [...older].reverse()));
      setHistory(older.length < spaceMessagePageSize ? "complete" : "more");
    } catch {
      setHistory((previous) => (previous === "loading" ? "more" : previous));
    }
  }, [conversationId, key, setHistory, setMessages, spaceId]);
  const reload = useCallback(() => {
    reloadMessages();
    if (spaceId && conversationId) void reloadSpaceConversations(spaceId).catch(() => {});
  }, [conversationId, reloadMessages, spaceId]);
  return {
    conversations,
    conversationsPending:
      Boolean(conversationId) && (conversationList.loading || conversationList.refreshing),
    messages,
    setMessages,
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
