import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useSpacesStore } from "@/features/spaces";
import { chatMuteId, useMessageNotices } from "@/shared/lib/messageNotices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { dmName, dmPath, peekDm } from "./directData";
import { isDoNotDisturb } from "./statusStore";

interface MessageLike {
  id?: unknown;
  sender_user_id?: unknown;
  sender_name?: unknown;
  sender_kind?: unknown;
  thread_root_id?: unknown;
  content?: unknown;
}

/** The message's text with its mentions as typed, for the notice's line. */
function lineOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((span: { text?: unknown; label?: unknown; type?: unknown }) =>
      span.type === "mention" ? `@${String(span.label ?? "")}` : String(span.text ?? span.label ?? ""),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function mentions(content: unknown, userId: string): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (span: { type?: unknown; user_id?: unknown }) =>
        span.type === "mention" && span.user_id === userId,
    )
  );
}

/**
 * Tells the person through the system when a message arrives in a DM or a Space while Misty isn't
 * in front: every DM message, and in a Space the ones that name them (or every one, or none, as
 * Settings › Profile › Notifications says). Muted chats and Do not disturb stay quiet. Native code
 * shows one notice for all windows and never while one is focused. Mounted once per window.
 */
export function MessageNotifier({ accountId }: { accountId: string }) {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const onMessage = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spaceId?: string;
          conversationId?: string;
          event?: { type?: string; payload?: MessageLike };
        }>
      ).detail;
      const spaceId = detail?.spaceId;
      const message = detail?.event?.payload;
      if (!spaceId || detail?.event?.type !== "message.created" || !message) return;
      if (message.sender_user_id === accountId || message.sender_kind === "system") return;
      if (message.thread_root_id || typeof message.id !== "string") return;
      if (isDoNotDisturb()) return;
      const prefs = useMessageNotices.getState().value;
      // A muted Space or DM, or one muted channel of a Space, stays quiet.
      if (prefs.muted.includes(spaceId)) return;
      if (prefs.muted.includes(chatMuteId(spaceId, detail.conversationId))) return;
      const dm = peekDm(spaceId);
      const sender = String(message.sender_name ?? "").trim() || "Someone";
      let title: string;
      let route: string;
      if (dm) {
        if (!prefs.direct) return;
        title = dm.kind === "group" ? `${sender} in ${dmName(dm, accountId)}` : sender;
        route = dmPath(spaceId);
      } else {
        if (prefs.spaces === "off") return;
        if (prefs.spaces === "mentions" && !mentions(message.content, accountId)) return;
        const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
        title = space ? `${sender} in ${space.name}` : sender;
        route = `/spaces/${encodeURIComponent(spaceId)}/chat`;
      }
      void invoke("chat_message_notify", {
        messageId: message.id,
        title,
        body: lineOf(message.content),
        route,
      }).catch(() => undefined);
    };
    window.addEventListener("misty:space-message-event", onMessage);
    return () => window.removeEventListener("misty:space-message-event", onMessage);
  }, [accountId]);
  return null;
}
