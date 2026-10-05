import { socialEvents } from "../SocialRuntime";
import { socialApi as spacesApi } from "../SocialRuntime";
import type {
  SpaceConversation,
  SpaceEvent,
  SpaceMessage,
} from "@/api/spaces/dto/interfaces/types";
import { readApiSessionGeneration } from "@/api/client/session";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { mergeSpaceMessages, messageFromSpaceEvent } from "../store/useSpaceMessageSpansStore";

const pendingByConversation = new Map<string, SpaceMessage[]>();
let pendingGeneration = -1;
export function useSpaceConversationChat(
  spaceId: string,
  conversationId: string,
  canRead: boolean,
) {
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
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
  const [loadedConversationId, setLoadedConversationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const activeConversationIdRef = useRef("");
  const reloadMessages = useCallback(() => setReloadRevision((current) => current + 1), []);
  useEffect(() => {
    if (!canRead || !conversationId) {
      setConversations([]);
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
    const request = conversationId
      ? Promise.all([
          spacesApi.conversations(spaceId),
          spacesApi.conversationMessages(spaceId, conversationId),
        ])
      : Promise.all([spacesApi.conversations(spaceId), Promise.resolve({ messages: [] })]);
    void request
      .then(([conversationResult, messageResult]) => {
        if (!active) return;
        setConversations(conversationResult.conversations);
        const ordered = [...messageResult.messages].reverse();
        setMessages((current) =>
          mergeSpaceMessages(
            current.filter((message) => Boolean(message.local_delivery_state)),
            ordered,
          ),
        );
        if (conversationId) setLoadedConversationId(conversationId);
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
      const includedMessage = detail.event ? messageFromSpaceEvent(detail.event) : undefined;
      if (includedMessage) {
        setMessages((current) => mergeSpaceMessages(current, [includedMessage]));
        return;
      }
      void spacesApi
        .conversationMessages(spaceId, conversationId)
        .then(({ messages: next }) => {
          if (!active) return;
          setMessages((current) =>
            mergeSpaceMessages(
              current.filter((message) => Boolean(message.local_delivery_state)),
              [...next].reverse(),
            ),
          );
          setError("");
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "This group chat could not be loaded.",
            );
        });
    };
    socialEvents.addEventListener("misty:space-message-event", reload);
    return () => {
      active = false;
      socialEvents.removeEventListener("misty:space-message-event", reload);
    };
  }, [canRead, conversationId, reloadRevision, spaceId, key, setMessages]);
  return {
    conversations,
    messages,
    setMessages,
    loadedConversationId,
    loading,
    error,
    setError: (value: string) => {
      if (currentKey.current === key) setError(value);
    },
    reload: reloadMessages,
  };
}
