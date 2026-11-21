import { useCallback, useEffect, useRef, useState } from "react";
import { spacesApi } from "../../api/api";
import type { SpaceEvent, SpaceMember, SpaceMessage } from "../../api/dto/entities";
import { runOwnMentions } from "../mentionRuns";
import {
  buildMessageSpans,
  mergeSpaceMessages,
  messageFromSpaceEvent,
  type MentionableAgent,
} from "../useSpaceMessageSpansStore";

/**
 * One thread's replies, for the panel beside the chat. They come from the server's own page of the
 * thread (never from the chat's loaded messages), stay current from the Space's live events, and a
 * reply sent here goes out with the thread's root, so it never lands in the channel's own list.
 */
export function useSpaceThread(options: {
  spaceId: string;
  /** The conversation the thread is in; "" for the Space's Everyone chat. */
  conversationId: string;
  rootId: string;
  currentUser: { id: string; name: string } | undefined;
  members: SpaceMember[];
  agents?: MentionableAgent[];
  roles?: readonly { id: string; name: string }[];
  /** Runs before a reply goes out, such as listing a mentioned agent in the conversation. */
  beforeSend?: (content: SpaceMessage["content"]) => Promise<void>;
}) {
  const { spaceId, conversationId, rootId } = options;
  const [replies, setReplies] = useState<SpaceMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(new Set<string>());
  const loadingOlderRef = useRef(false);
  const activeThreadRef = useRef("");
  const latest = useRef(options);
  latest.current = options;
  const threadKey = `${spaceId}:${rootId}`;

  // Reading the thread moves the person's place in it forward, which clears its unread.
  const markRead = useCallback(
    () => void spacesApi.markThreadRead(spaceId, rootId).catch(() => undefined),
    [spaceId, rootId],
  );

  useEffect(() => {
    if (!rootId) {
      setReplies([]);
      setHasOlder(false);
      setLoading(false);
      return;
    }
    let active = true;
    activeThreadRef.current = threadKey;
    setReplies([]);
    setLoading(true);
    setHasOlder(false);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    setError("");
    const load = () =>
      spacesApi
        .threadReplies(spaceId, rootId)
        .then(({ messages, has_older }) => {
          if (!active) return;
          setReplies((current) => mergeSpaceMessages(current, messages));
          setHasOlder(has_older && messages.length > 0);
          setError("");
          markRead();
        })
        .catch((reason) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "This thread could not be loaded.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    void load();
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; event?: SpaceEvent }>).detail;
      if (detail?.spaceId !== spaceId || !detail.event) return;
      const deletedId =
        detail.event.type === "message.deleted" && typeof detail.event.payload.message_id === "string"
          ? detail.event.payload.message_id
          : "";
      if (deletedId) {
        setReplies((current) => current.filter((message) => message.id !== deletedId));
        return;
      }
      const included = messageFromSpaceEvent(detail.event);
      if (included?.thread_root_id !== rootId) return;
      setReplies((current) => mergeSpaceMessages(current, [included]));
      // Open in front of the person: what arrives is read.
      if (detail.event.type === "message.created") markRead();
    };
    window.addEventListener("misty:space-message-event", onEvent);
    return () => {
      active = false;
      if (activeThreadRef.current === threadKey) activeThreadRef.current = "";
      window.removeEventListener("misty:space-message-event", onEvent);
    };
  }, [spaceId, rootId, markRead, threadKey]);

  const loadOlder = useCallback(async () => {
    const oldest = replies.find((message) => !message.local_delivery_state);
    if (!hasOlder || !oldest || loadingOlderRef.current) return false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await spacesApi.threadReplies(spaceId, rootId, oldest.seq);
      if (activeThreadRef.current !== threadKey) return false;
      setReplies((current) => mergeSpaceMessages(current, page.messages));
      setHasOlder(page.has_older && page.messages.length > 0);
      setError("");
      return page.messages.length > 0;
    } catch (reason) {
      if (activeThreadRef.current === threadKey)
        setError(reason instanceof Error ? reason.message : "Older replies could not be loaded.");
      return false;
    } finally {
      loadingOlderRef.current = false;
      if (activeThreadRef.current === threadKey) setLoadingOlder(false);
    }
  }, [hasOlder, replies, rootId, spaceId, threadKey]);

  const send = useCallback(
    async (text: string) => {
      const value = text.trim();
      const current = latest.current;
      if (!value || !current.currentUser) return;
      const nonce = `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      if (sending.current.has(nonce)) return;
      sending.current.add(nonce);
      const content = buildMessageSpans(value, current.members, current.agents, current.roles);
      const optimistic: SpaceMessage = {
        seq: Date.now(),
        id: `optimistic_${nonce}`,
        client_nonce: nonce,
        local_delivery_state: "sending",
        space_id: spaceId,
        conversation_id: conversationId || undefined,
        sender_user_id: current.currentUser.id,
        sender_name: current.currentUser.name || "You",
        sender_kind: "person",
        content,
        file_node_ids: [],
        attachments: [],
        reactions: [],
        thread_root_id: rootId,
        created_at: new Date().toISOString(),
      };
      setReplies((list) => mergeSpaceMessages(list, [optimistic]));
      try {
        await current.beforeSend?.(content);
        const response = conversationId
          ? await spacesApi.sendConversationMessage(
              spaceId,
              conversationId,
              content,
              [],
              [],
              "",
              nonce,
              "text",
              rootId,
            )
          : await spacesApi.sendMessage(spaceId, content, [], [], "", nonce, rootId);
        response.message.client_nonce ||= nonce;
        setReplies((list) => mergeSpaceMessages(list, [response.message]));
        runOwnMentions(response.message, current.agents, current.currentUser.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The reply could not be sent.");
        setReplies((list) =>
          list.map((message) =>
            message.client_nonce === nonce && message.local_delivery_state
              ? { ...message, local_delivery_state: "failed" }
              : message,
          ),
        );
      } finally {
        sending.current.delete(nonce);
      }
    },
    [spaceId, conversationId, rootId],
  );

  return { replies, loading, loadingOlder, hasOlder, error, loadOlder, send };
}
